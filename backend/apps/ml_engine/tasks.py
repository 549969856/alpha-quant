"""
apps/ml_engine/tasks.py
Celery tasks for async ML training, live prediction, and feedback review.
"""
from __future__ import annotations

import logging
import os
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
from celery import shared_task
from django.conf import settings
from django.db.models import Max, Min
from django.utils import timezone

log = logging.getLogger(__name__)


def _upsert_ohlcv_frame(df_raw: pd.DataFrame, tick: str) -> int:
    from apps.market_data.models import OHLCVBar

    records = []
    for ts, row in df_raw.iterrows():
        records.append(OHLCVBar(
            ticker=tick,
            timestamp=ts.date(),
            open=float(row["open"]),
            high=float(row["high"]),
            low=float(row["low"]),
            close=float(row["close"]),
            adj_close=float(row["adj_close"]),
            volume=int(row["volume"]),
        ))

    if not records:
        return 0

    OHLCVBar.objects.bulk_create(
        records,
        update_conflicts=True,
        update_fields=["open", "high", "low", "close", "adj_close", "volume"],
        unique_fields=["ticker", "timestamp"],
    )
    return len(records)


def _fetch_and_store_range(fetcher, tick: str, start, end) -> int:
    padded_start = (pd.Timestamp(start) - pd.Timedelta(days=7)).strftime("%Y-%m-%d")
    padded_end = (pd.Timestamp(end) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
    df = fetcher.get_ohlcv(tick, padded_start, padded_end)
    return _upsert_ohlcv_frame(df, tick)


def _make_fetcher():
    from apps.ml_engine.pipeline.data_fetcher import DataFetcher

    return DataFetcher(
        cache_dir=Path(settings.BASE_DIR) / "data" / "cache",
        ttl_hours=24,
    )


def _sync_market_data(fetcher, ticker: str, benchmark: str, start, end, log_id: str):
    for tick in (ticker, benchmark):
        try:
            inserted = _fetch_and_store_range(fetcher, tick, start, end)
            log.info("Synced %s rows for %s before job %s", inserted, tick, log_id)
        except Exception as fetch_err:
            log.warning(
                "Market fetch failed for job %s ticker %s: %s. Fallback to existing DB rows.",
                log_id,
                tick,
                fetch_err,
            )


def _load_ohlcv(tick: str, start, end) -> pd.DataFrame:
    from apps.market_data.models import OHLCVBar

    qs = OHLCVBar.objects.filter(
        ticker=tick,
        timestamp__gte=start,
        timestamp__lte=end,
    ).order_by("timestamp").values("timestamp", "open", "high", "low", "adj_close", "volume")
    rows = list(qs)
    if not rows:
        agg = OHLCVBar.objects.filter(ticker=tick).aggregate(
            first_date=Min("timestamp"),
            last_date=Max("timestamp"),
        )
        first_date = agg["first_date"]
        last_date = agg["last_date"]
        if first_date and last_date:
            raise ValueError(
                f"No OHLCV rows for {tick} in selected range {start}~{end}. "
                f"Available DB range is {first_date}~{last_date}."
            )
        raise ValueError(
            f"No OHLCV rows for {tick} in selected range {start}~{end}. "
            "Fetch also failed, so TimescaleDB currently has no cached rows for this ticker."
        )

    df = pd.DataFrame(rows).set_index("timestamp")
    df.index = pd.to_datetime(df.index)
    return df.ffill().dropna()


def _feature_names_from_ids(feature_ids: list[str]) -> list[str]:
    from apps.market_data.models import FeatureDefinition

    feat_names = []
    for fid in feature_ids:
        feat_names.append(FeatureDefinition.objects.get(id=fid).name)
    return feat_names


def _build_training_data(ticker: str, benchmark: str, start, end, feature_ids: list[str], seq_len: int):
    from apps.ml_engine.pipeline.feature_engine import FeatureEngine

    stock_df = _load_ohlcv(ticker, start, end)
    bench_df = _load_ohlcv(benchmark, start, end)
    stock_df, bench_df = stock_df.align(bench_df, join="inner")
    feat_names = _feature_names_from_ids(feature_ids)
    engine = FeatureEngine(feat_names, seq_length=seq_len)
    data = engine.build(stock_df, bench_df)
    return stock_df, bench_df, feat_names, engine, data


def _build_split_indices(total_count: int, split_config: dict) -> tuple[int, int]:
    train_ratio = max(float(split_config.get("train", 70)), 0.0) / 100.0
    val_ratio = max(float(split_config.get("val", 15)), 0.0) / 100.0
    test_ratio = max(float(split_config.get("test", 15)), 0.0) / 100.0
    ratio_sum = train_ratio + val_ratio + test_ratio
    if abs(ratio_sum - 1.0) > 1e-6:
        raise ValueError("Split ratios must sum to 100%.")

    train_end = int(total_count * train_ratio)
    val_end = train_end + int(total_count * val_ratio)
    if train_end <= 0:
        raise ValueError("Train split is empty.")
    if val_end >= total_count:
        raise ValueError("Validation/test split is empty.")
    if (total_count - val_end) <= 0:
        raise ValueError("Test split is empty.")
    return train_end, val_end


def _save_progress(run_obj, epoch: int, loss: float):
    run_obj.epochs_done = epoch
    run_obj.loss_history = run_obj.loss_history + [{"epoch": epoch, "loss": round(loss, 6)}]
    run_obj.save(update_fields=["epochs_done", "loss_history"])


def _signal_to_position(signal: str) -> int:
    if signal == "LONG":
        return 1
    if signal == "SHORT":
        return -1
    return 0


def _find_existing_live_cycle_run(deployment, cycle_date=None):
    from django.db.models import Q

    cycle_date = cycle_date or timezone.localdate()
    return (
        deployment.runs.filter(
            Q(prediction_date=cycle_date) |
            Q(created_at__date=cycle_date, status__in=["pending", "training", "done"])
        )
        .exclude(status="failed")
        .order_by("-created_at", "-id")
        .first()
    )


@shared_task(bind=True, queue="data_fetch", name="fetch_market_data")
def fetch_market_data(self, ticker: str, benchmark: str, start: str, end: str) -> dict:
    """Download OHLCV and upsert into TimescaleDB."""
    log.info("Fetching %s | %s -> %s", ticker, start, end)

    fetcher = _make_fetcher()
    n1 = _fetch_and_store_range(fetcher, ticker, start, end)
    n2 = _fetch_and_store_range(fetcher, benchmark, start, end)
    return {"stock_rows": n1, "bench_rows": n2}


@shared_task(bind=True, queue="training", name="run_training", soft_time_limit=3600, time_limit=4000)
def run_training(self, run_id: str) -> dict:
    from apps.ml_engine.models import BacktestResult, ModelArtifact, PredictionRecord, TrainingRun
    from apps.ml_engine.pipeline.feature_engine import BacktestEngine
    from apps.ml_engine.pipeline.trainer import get_trainer, set_global_seed

    run = TrainingRun.objects.select_related("experiment", "model_arch").get(id=run_id)
    exp = run.experiment

    try:
        run.status = "training"
        run.started_at = timezone.now()
        run.celery_task_id = self.request.id
        run.save(update_fields=["status", "started_at", "celery_task_id"])
        exp.status = "running"
        exp.save(update_fields=["status"])

        fetcher = _make_fetcher()
        _sync_market_data(fetcher, exp.ticker, exp.benchmark, exp.date_start, exp.date_end, run_id)

        hp = dict(run.hparams or {})
        hp["random_seed"] = exp.random_seed
        set_global_seed(exp.random_seed)

        seq_len = int(hp.get("seq_length", 60))
        stock_df, bench_df, feat_names, engine, data = _build_training_data(
            exp.ticker,
            exp.benchmark,
            exp.date_start,
            exp.date_end,
            exp.feature_ids,
            seq_len,
        )

        total_count = len(data["windows"])
        if total_count < 20:
            raise ValueError("Not enough training windows. Please expand date range or reduce seq_length.")

        train_end, val_end = _build_split_indices(total_count, exp.split_config or {"train": 70, "val": 15, "test": 15})
        X_train = data["windows"][:train_end]
        meta_train = {k: data[k][:train_end] for k in ("next_ret", "bench_ret", "vol_20d")}
        X_test = data["windows"][val_end:]
        test_dates = data["dates"][val_end:]
        actual_ret = data["next_ret"][val_end:]

        run.train_size = train_end
        run.val_size = val_end - train_end
        run.test_size = total_count - val_end
        run.save(update_fields=["train_size", "val_size", "test_size"])

        trainer = get_trainer(run.model_arch.arch, len(feat_names), hp)
        trainer.fit(X_train, meta_train, callback=lambda epoch, loss: _save_progress(run, epoch, loss))

        artifact_dir = settings.MODEL_ARTIFACTS_DIR
        ext = ".pt" if run.model_arch.arch in {"transformer", "lstm", "gru", "tcn"} else ".pkl"
        artifact_path = os.path.join(artifact_dir, f"{run_id}{ext}")
        trainer.save(artifact_path)
        ModelArtifact.objects.update_or_create(
            run=run,
            defaults=dict(
                artifact_path=artifact_path,
                model_size_kb=os.path.getsize(artifact_path) // 1024,
            ),
        )

        bt_engine = BacktestEngine(
            confidence_threshold=hp.get("confidence_threshold", 0.45),
            transaction_cost=hp.get("transaction_cost", 0.002),
            directional_threshold=hp.get("directional_threshold", 0.05),
        )
        probs_test = trainer.predict(X_test)
        bt_result = bt_engine.run(probs_test, actual_ret, test_dates)
        m = bt_result["metrics"]
        BacktestResult.objects.update_or_create(
            run=run,
            defaults=dict(
                total_return=m["total_return"],
                bh_return=m["bh_return"],
                annualized_ret=m["annualized_ret"],
                sharpe_ratio=m["sharpe_ratio"],
                calmar_ratio=m["calmar_ratio"],
                max_drawdown=m["max_drawdown"],
                win_rate=m["win_rate"],
                turnover_rate=m["turnover_rate"],
                equity_curve=bt_result["equity_curve"],
                bh_curve=bt_result["bh_curve"],
                drawdown_curve=bt_result["drawdown_curve"],
                position_log=bt_result["position_log"],
            ),
        )

        last_window = engine.build_last_window(stock_df, bench_df)
        last_probs = trainer.predict(last_window)
        tomorrow = bt_engine.predict_tomorrow(last_probs, data["feat_df"])
        today = date.today()
        PredictionRecord.objects.update_or_create(
            run=run,
            prediction_date=today,
            defaults=dict(
                target_date=today + timedelta(days=1),
                signal=tomorrow["signal"],
                prob_long=tomorrow["prob_long"],
                prob_short=tomorrow["prob_short"],
                prob_neutral=tomorrow["prob_neutral"],
                confidence=tomorrow["confidence"],
                rsi_14=tomorrow["rsi_14"],
                vol_ann=tomorrow["vol_ann"],
                stop_loss_pct=tomorrow["stop_loss_pct"],
                target_pct=tomorrow["target_pct"],
            ),
        )

        run.status = "done"
        run.finished_at = timezone.now()
        run.save(update_fields=["status", "finished_at"])
        exp.status = "done"
        exp.save(update_fields=["status"])

        log.info("TrainingRun %s completed | Sharpe=%s", run_id, m["sharpe_ratio"])
        return {"status": "done", "run_id": run_id, "metrics": m, "prediction": tomorrow}

    except Exception as exc:
        run.status = "failed"
        run.error_msg = str(exc)
        run.save(update_fields=["status", "error_msg"])
        exp.status = "failed"
        exp.save(update_fields=["status"])
        log.exception("TrainingRun %s failed: %s", run_id, exc)
        raise


@shared_task(bind=True, queue="training", name="run_live_prediction", soft_time_limit=3600, time_limit=4000)
def run_live_prediction(self, live_run_id: str) -> dict:
    from apps.ml_engine.models import LivePredictionFeedback, LiveRun
    from apps.ml_engine.pipeline.feature_engine import BacktestEngine
    from apps.ml_engine.pipeline.trainer import get_trainer, set_global_seed

    live_run = LiveRun.objects.select_related("deployment", "deployment__model_arch").get(id=live_run_id)
    deployment = live_run.deployment

    try:
        live_run.status = "training"
        live_run.started_at = timezone.now()
        live_run.celery_task_id = self.request.id
        live_run.training_window_start = deployment.date_start
        live_run.training_window_end = deployment.date_end
        live_run.save(update_fields=[
            "status",
            "started_at",
            "celery_task_id",
            "training_window_start",
            "training_window_end",
        ])
        deployment.status = "running"
        deployment.save(update_fields=["status"])

        fetcher = _make_fetcher()
        _sync_market_data(fetcher, deployment.ticker, deployment.benchmark, deployment.date_start, deployment.date_end, live_run_id)

        hp = dict(deployment.hparams or {})
        hp["random_seed"] = deployment.random_seed
        set_global_seed(deployment.random_seed)

        seq_len = int(hp.get("seq_length", 60))
        stock_df, bench_df, feat_names, engine, data = _build_training_data(
            deployment.ticker,
            deployment.benchmark,
            deployment.date_start,
            deployment.date_end,
            deployment.feature_ids,
            seq_len,
        )

        total_count = len(data["windows"])
        if total_count < 20:
            raise ValueError("Not enough live training windows. Please expand date range or reduce seq_length.")

        X_train = data["windows"]
        meta_train = {k: data[k] for k in ("next_ret", "bench_ret", "vol_20d")}
        live_run.train_size = total_count
        live_run.save(update_fields=["train_size"])

        trainer = get_trainer(deployment.model_arch.arch, len(feat_names), hp)
        trainer.fit(X_train, meta_train, callback=lambda epoch, loss: _save_progress(live_run, epoch, loss))

        artifact_dir = settings.MODEL_ARTIFACTS_DIR
        ext = ".pt" if deployment.model_arch.arch in {"transformer", "lstm", "gru", "tcn"} else ".pkl"
        artifact_path = os.path.join(artifact_dir, f"live_{live_run_id}{ext}")
        trainer.save(artifact_path)

        bt_engine = BacktestEngine(
            confidence_threshold=hp.get("confidence_threshold", 0.45),
            transaction_cost=hp.get("transaction_cost", 0.002),
            directional_threshold=hp.get("directional_threshold", 0.05),
        )
        last_window = engine.build_last_window(stock_df, bench_df)
        last_probs = trainer.predict(last_window)
        tomorrow = bt_engine.predict_tomorrow(last_probs, data["feat_df"])
        today = date.today()

        live_run.artifact_path = artifact_path
        live_run.prediction_date = today
        live_run.target_date = today + timedelta(days=1)
        live_run.signal = tomorrow["signal"]
        live_run.prob_long = tomorrow["prob_long"]
        live_run.prob_short = tomorrow["prob_short"]
        live_run.prob_neutral = tomorrow["prob_neutral"]
        live_run.confidence = tomorrow["confidence"]
        live_run.rsi_14 = tomorrow["rsi_14"]
        live_run.vol_ann = tomorrow["vol_ann"]
        live_run.stop_loss_pct = tomorrow["stop_loss_pct"]
        live_run.target_pct = tomorrow["target_pct"]
        live_run.status = "done"
        live_run.finished_at = timezone.now()
        live_run.save(update_fields=[
            "artifact_path",
            "prediction_date",
            "target_date",
            "signal",
            "prob_long",
            "prob_short",
            "prob_neutral",
            "confidence",
            "rsi_14",
            "vol_ann",
            "stop_loss_pct",
            "target_pct",
            "status",
            "finished_at",
        ])

        deployment.status = "ready"
        deployment.save(update_fields=["status"])

        # Recompute historical feedback whenever a new live run finishes.
        evaluate_live_feedback.delay(str(deployment.id))

        return {
            "status": "done",
            "live_run_id": live_run_id,
            "prediction": tomorrow,
            "window": {
                "start": str(deployment.date_start),
                "end": str(deployment.date_end),
            },
        }
    except Exception as exc:
        live_run.status = "failed"
        live_run.error_msg = str(exc)
        live_run.save(update_fields=["status", "error_msg"])
        deployment.status = "failed"
        deployment.save(update_fields=["status"])
        log.exception("LiveRun %s failed: %s", live_run_id, exc)
        raise


@shared_task(bind=True, queue="training", name="run_scheduled_live_predictions")
def run_scheduled_live_predictions(self) -> dict:
    from apps.ml_engine.models import LiveDeployment, LiveRun

    now = timezone.localtime()
    today = timezone.localdate()
    queued = 0

    deployments = LiveDeployment.objects.filter(auto_predict_enabled=True).select_related("model_arch")
    for deployment in deployments:
        if not deployment.auto_predict_time:
            continue
        if deployment.last_auto_predicted_for == today:
            continue
        if _find_existing_live_cycle_run(deployment, today):
            continue

        scheduled_at = now.replace(
            hour=deployment.auto_predict_time.hour,
            minute=deployment.auto_predict_time.minute,
            second=deployment.auto_predict_time.second,
            microsecond=0,
        )
        if now < scheduled_at:
            continue

        deployment.date_end = today - timedelta(days=1)
        deployment.status = "queued"
        deployment.last_auto_predicted_for = today
        deployment.save(update_fields=["date_end", "status", "last_auto_predicted_for", "updated_at"])

        live_run = LiveRun.objects.create(deployment=deployment, status="pending")
        task = run_live_prediction.apply_async(args=[str(live_run.id)], queue="training")
        live_run.celery_task_id = task.id
        live_run.save(update_fields=["celery_task_id"])
        queued += 1

    return {"queued": queued, "checked_at": now.isoformat()}


@shared_task(bind=True, queue="training", name="evaluate_live_feedback")
def evaluate_live_feedback(self, deployment_id: str) -> dict:
    from apps.ml_engine.models import LiveDeployment, LivePredictionFeedback
    from apps.market_data.models import OHLCVBar

    deployment = LiveDeployment.objects.get(id=deployment_id)
    runs = deployment.runs.filter(status="done").order_by("target_date", "created_at")

    reviewed = 0
    cumulative_pnl = 0.0
    correct_count = 0

    for idx, run in enumerate(runs, start=1):
        if not run.target_date or not run.signal:
            continue

        bar = OHLCVBar.objects.filter(
            ticker=deployment.ticker,
            timestamp=run.target_date,
        ).values("open", "close").first()
        if not bar or not bar["open"]:
            continue

        actual_return = float(bar["close"] - bar["open"]) / float(bar["open"])
        predicted_return = (
            (run.prob_long or 0.0) - (run.prob_short or 0.0)
        ) * max(abs(actual_return), 0.0001)
        position = _signal_to_position(run.signal)
        realized_pnl = position * actual_return
        cumulative_pnl += realized_pnl
        was_correct = (
            (position == 1 and actual_return > 0) or
            (position == -1 and actual_return < 0) or
            (position == 0 and abs(actual_return) <= 0.002)
        )
        if was_correct:
            correct_count += 1

        hit_rate = correct_count / idx
        alpha_drift = predicted_return - realized_pnl

        LivePredictionFeedback.objects.update_or_create(
            live_run=run,
            defaults=dict(
                deployment=deployment,
                prediction_date=run.prediction_date,
                target_date=run.target_date,
                predicted_signal=run.signal,
                actual_return=actual_return,
                predicted_return=predicted_return,
                realized_pnl=realized_pnl,
                was_correct=was_correct,
                hit_rate=hit_rate,
                cumulative_pnl=cumulative_pnl,
                alpha_drift=alpha_drift,
            ),
        )
        reviewed += 1

    return {"deployment_id": deployment_id, "reviewed": reviewed}


@shared_task(bind=True, queue="training", name="evaluate_all_live_feedback")
def evaluate_all_live_feedback(self) -> dict:
    from apps.ml_engine.models import LiveDeployment

    reviewed = 0
    for deployment in LiveDeployment.objects.filter(status__in=["ready", "running", "queued"]):
        evaluate_live_feedback(str(deployment.id))
        reviewed += 1
    return {"deployments": reviewed}
