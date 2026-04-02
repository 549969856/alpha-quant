"""
apps/backtest/tasks.py
Async Celery tasks for extended backtest analytics.
"""
import logging
from celery import shared_task

log = logging.getLogger(__name__)


@shared_task(bind=True, queue="training", name="run_walk_forward")
def run_walk_forward(self, run_id: str, n_splits: int = 5) -> dict:
    """
    Runs walk-forward validation for a completed TrainingRun.
    Requires the run to be in "done" status.
    """
    from apps.ml_engine.models import TrainingRun
    from apps.ml_engine.pipeline.feature_engine import FeatureEngine
    from apps.ml_engine.pipeline.trainer import get_trainer
    from apps.backtest.models import WalkForwardResult
    from apps.backtest.analytics import walk_forward_validate
    from apps.market_data.models import OHLCVBar, FeatureDefinition
    import pandas as pd

    run = TrainingRun.objects.select_related("experiment", "model_arch").get(id=run_id)
    exp = run.experiment
    hp  = run.hparams

    log.info(f"Walk-forward: run={run_id}, splits={n_splits}")

    # Load data
    def _load(tick):
        qs = OHLCVBar.objects.filter(
            ticker=tick,
            timestamp__gte=exp.date_start,
            timestamp__lte=exp.date_end,
        ).order_by("timestamp").values(
            "timestamp","open","high","low","adj_close","volume")
        df = pd.DataFrame(list(qs)).set_index("timestamp")
        df.index = pd.to_datetime(df.index)
        return df.ffill().dropna()

    stock_df = _load(exp.ticker)
    bench_df = _load(exp.benchmark)
    stock_df, bench_df = stock_df.align(bench_df, join="inner")

    feat_names = [
        FeatureDefinition.objects.get(id=fid).name
        for fid in exp.feature_ids
    ]
    seq_len = hp.get("seq_length", 60)
    engine  = FeatureEngine(feat_names, seq_length=seq_len)
    data    = engine.build(stock_df, bench_df)

    def _factory(arch, input_dim, hparams):
        return get_trainer(arch, input_dim, hparams)

    wf_results = walk_forward_validate(
        trainer_factory      = _factory,
        arch                 = run.model_arch.arch,
        input_dim            = len(feat_names),
        hparams              = hp,
        windows_data         = data["windows"],
        next_ret             = data["next_ret"],
        bench_ret            = data["bench_ret"],
        vol_20d              = data["vol_20d"],
        dates                = data["dates"],
        n_splits             = n_splits,
        confidence_threshold = hp.get("confidence_threshold", 0.45),
        transaction_cost     = hp.get("transaction_cost", 0.002),
    )

    # Persist results
    WalkForwardResult.objects.filter(run=run).delete()
    objs = [
        WalkForwardResult(
            run=run,
            window_idx      = r["window_idx"],
            train_start     = r["train_start"],
            train_end       = r["train_end"],
            test_start      = r["test_start"],
            test_end        = r["test_end"],
            is_total_return = r["is_total_return"],
            is_sharpe       = r["is_sharpe"],
            oos_total_return= r["oos_total_return"],
            oos_sharpe      = r["oos_sharpe"],
            oos_max_drawdown= r["oos_max_drawdown"],
            oos_win_rate    = r["oos_win_rate"],
            equity_curve    = r["equity_curve"],
        )
        for r in wf_results
    ]
    WalkForwardResult.objects.bulk_create(objs)
    log.info(f"Walk-forward complete: {len(objs)} windows saved")
    return {"windows": len(objs), "run_id": run_id}


@shared_task(bind=True, queue="training", name="run_monte_carlo")
def run_monte_carlo(self, run_id: str, n_simulations: int = 1000) -> dict:
    """
    Runs Monte Carlo permutation test for a completed TrainingRun.
    Uses the actual daily returns from BacktestResult.
    """
    from apps.ml_engine.models import TrainingRun, BacktestResult
    from apps.backtest.models import MonteCarloResult
    from apps.backtest.analytics import monte_carlo_permutation
    import numpy as np

    run = TrainingRun.objects.get(id=run_id)
    bt  = BacktestResult.objects.get(run=run)

    # Reconstruct daily returns from equity curve
    vals = [p["value"] for p in bt.equity_curve]
    rets = np.diff(vals) / np.array(vals[:-1])

    mc = monte_carlo_permutation(rets, n_simulations=n_simulations)

    MonteCarloResult.objects.update_or_create(
        run=run,
        defaults={**mc},
    )
    log.info(f"Monte Carlo complete: p={mc['p_value']:.4f}, rank={mc['percentile_rank']:.1f}%")
    return mc
