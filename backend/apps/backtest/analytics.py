"""
apps/backtest/analytics.py

Advanced backtest analytics:
  • walk_forward_validate()  — rolling IS/OOS validation
  • monte_carlo_permutation() — permutation significance test
  • build_comparison_table()  — rank runs within an experiment
"""
from __future__ import annotations
import numpy as np
from datetime import date


# ─────────────────────────────────────────────
# Walk-Forward Validation
# ─────────────────────────────────────────────
def walk_forward_validate(
    trainer_factory,          # callable(arch, input_dim, hparams) → BaseTrainer
    arch: str,
    input_dim: int,
    hparams: dict,
    windows_data: np.ndarray,  # (N, T, F)
    next_ret: np.ndarray,
    bench_ret: np.ndarray,
    vol_20d: np.ndarray,
    dates: list,
    n_splits: int = 5,
    min_train_pct: float = 0.6,
    confidence_threshold: float = 0.45,
    transaction_cost: float = 0.002,
) -> list[dict]:
    """
    Splits data into n_splits consecutive folds.
    Each fold: train on [start → split], test on [split → next_split].
    Returns list of per-window result dicts.
    """
    from apps.ml_engine.pipeline.feature_engine import BacktestEngine

    N     = len(windows_data)
    fold_size = N // (n_splits + 1)
    results   = []

    for i in range(n_splits):
        train_end = fold_size * (i + 2)    # grow training window
        test_start = train_end
        test_end   = min(test_start + fold_size, N)

        if test_end <= test_start:
            continue

        X_train = windows_data[:train_end]
        meta_tr = {
            "next_ret":  next_ret[:train_end],
            "bench_ret": bench_ret[:train_end],
            "vol_20d":   vol_20d[:train_end],
        }
        X_test   = windows_data[test_start:test_end]
        ret_test = next_ret[test_start:test_end]
        dates_test = dates[test_start:test_end]

        # Train fresh model per fold
        trainer = trainer_factory(arch, input_dim, hparams)
        trainer.fit(X_train, meta_tr)

        # IS performance (last fold_size of training)
        is_start = max(0, train_end - fold_size)
        probs_is = trainer.predict(windows_data[is_start:train_end])
        bt = BacktestEngine(confidence_threshold, transaction_cost)
        is_bt = bt.run(probs_is, next_ret[is_start:train_end],
                       dates[is_start:train_end])

        # OOS performance
        probs_oos = trainer.predict(X_test)
        oos_bt    = bt.run(probs_oos, ret_test, dates_test)

        results.append({
            "window_idx":      i,
            "train_start":     str(dates[0]),
            "train_end":       str(dates[train_end - 1]),
            "test_start":      str(dates_test[0]),
            "test_end":        str(dates_test[-1]),
            "is_total_return":  is_bt["metrics"]["total_return"],
            "is_sharpe":        is_bt["metrics"]["sharpe_ratio"],
            "oos_total_return": oos_bt["metrics"]["total_return"],
            "oos_sharpe":       oos_bt["metrics"]["sharpe_ratio"],
            "oos_max_drawdown": oos_bt["metrics"]["max_drawdown"],
            "oos_win_rate":     oos_bt["metrics"]["win_rate"],
            "equity_curve":     oos_bt["equity_curve"],
        })

    return results


# ─────────────────────────────────────────────
# Monte Carlo Permutation Test
# ─────────────────────────────────────────────
def monte_carlo_permutation(
    actual_daily_rets: np.ndarray,
    n_simulations: int = 1000,
    seed: int = 42,
) -> dict:
    """
    Permutes the daily return sequence n_simulations times and
    computes the total return of each permutation.
    Returns p-value: probability a RANDOM strategy beats actual.
    """
    rng = np.random.default_rng(seed)
    actual_total = float(np.prod(1 + actual_daily_rets) - 1)

    sim_totals = []
    for _ in range(n_simulations):
        perm   = rng.permutation(actual_daily_rets)
        total  = float(np.prod(1 + perm) - 1)
        sim_totals.append(total)

    arr = np.array(sim_totals)

    # Build histogram for chart
    counts, edges = np.histogram(arr, bins=40)
    histogram = [
        {"bin_start": round(float(edges[i]),4),
         "bin_end":   round(float(edges[i+1]),4),
         "count":     int(counts[i])}
        for i in range(len(counts))
    ]

    pct_rank = float((arr < actual_total).mean() * 100)

    return {
        "n_simulations":   n_simulations,
        "sim_mean_return": round(float(arr.mean()), 6),
        "sim_std_return":  round(float(arr.std()),  6),
        "sim_p5_return":   round(float(np.percentile(arr, 5)),  6),
        "sim_p95_return":  round(float(np.percentile(arr, 95)), 6),
        "actual_return":   round(actual_total, 6),
        "percentile_rank": round(pct_rank, 2),
        "p_value":         round(1 - pct_rank / 100, 4),
        "histogram_bins":  histogram,
    }


# ─────────────────────────────────────────────
# Build Comparison Table
# ─────────────────────────────────────────────
def build_comparison_table(runs_with_metrics: list[dict]) -> list[dict]:
    """
    Input: [{"run_id": ..., "label": ..., "metrics": {...}}, ...]
    Output: sorted by Sharpe descending, with rank field added.
    """
    sorted_runs = sorted(
        runs_with_metrics,
        key=lambda r: r["metrics"].get("sharpe_ratio", -999),
        reverse=True,
    )
    result = []
    for rank, r in enumerate(sorted_runs, start=1):
        m = r["metrics"]
        result.append({
            "rank":          rank,
            "run_id":        str(r["run_id"]),
            "label":         r["label"],
            "total_return":  m.get("total_return", 0),
            "annualized_ret":m.get("annualized_ret", 0),
            "sharpe_ratio":  m.get("sharpe_ratio", 0),
            "calmar_ratio":  m.get("calmar_ratio", 0),
            "max_drawdown":  m.get("max_drawdown", 0),
            "win_rate":      m.get("win_rate", 0),
            "turnover_rate": m.get("turnover_rate", 0),
        })
    return result
