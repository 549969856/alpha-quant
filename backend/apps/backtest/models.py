"""
apps/backtest/models.py

Extended backtest analysis models:
  • WalkForwardResult  — rolling walk-forward validation windows
  • MonteCarloResult   — permutation/bootstrap confidence intervals
  • BenchmarkComparison — multi-run comparison table
"""
import uuid
from django.db import models


class WalkForwardResult(models.Model):
    """
    Walk-forward validation: splits test set into N rolling windows
    and records in-sample vs out-of-sample performance per window.
    Detects overfitting patterns.
    """
    id        = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run       = models.ForeignKey(
        "ml_engine.TrainingRun", on_delete=models.CASCADE,
        related_name="walk_forward_results"
    )
    window_idx    = models.IntegerField()          # 0-indexed window number
    train_start   = models.DateField()
    train_end     = models.DateField()
    test_start    = models.DateField()
    test_end      = models.DateField()

    # In-sample metrics
    is_total_return   = models.FloatField()
    is_sharpe         = models.FloatField()
    # Out-of-sample metrics
    oos_total_return  = models.FloatField()
    oos_sharpe        = models.FloatField()
    oos_max_drawdown  = models.FloatField()
    oos_win_rate      = models.FloatField()

    equity_curve      = models.JSONField(default=list)   # [{date, value}]
    created_at        = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "walk_forward_results"
        ordering = ["run", "window_idx"]
        unique_together = [("run", "window_idx")]


class MonteCarloResult(models.Model):
    """
    Monte Carlo permutation test:
    Shuffles the return sequence N times and measures
    how often random strategies beat the trained model.
    Provides statistical significance of the alpha.
    """
    id             = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run            = models.OneToOneField(
        "ml_engine.TrainingRun", on_delete=models.CASCADE,
        related_name="monte_carlo"
    )
    n_simulations  = models.IntegerField(default=1000)

    # Distribution of random strategy returns
    sim_mean_return   = models.FloatField()
    sim_std_return    = models.FloatField()
    sim_p5_return     = models.FloatField()   # 5th percentile
    sim_p95_return    = models.FloatField()   # 95th percentile

    # Actual strategy vs distribution
    actual_return     = models.FloatField()
    percentile_rank   = models.FloatField()   # % of sims beaten (0-100)
    p_value           = models.FloatField()   # 1 - percentile_rank/100

    # Full histogram bins for chart rendering
    histogram_bins    = models.JSONField(default=list)  # [{bin_start, bin_end, count}]
    created_at        = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "monte_carlo_results"


class BenchmarkComparison(models.Model):
    """
    Side-by-side comparison table across multiple TrainingRuns
    within the same Experiment. Helps users identify the best
    model + feature combination.
    """
    id         = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    experiment = models.ForeignKey(
        "ml_engine.Experiment", on_delete=models.CASCADE,
        related_name="comparisons"
    )
    run        = models.ForeignKey(
        "ml_engine.TrainingRun", on_delete=models.CASCADE,
        related_name="comparisons"
    )
    rank       = models.IntegerField()        # 1 = best Sharpe in experiment

    total_return    = models.FloatField()
    annualized_ret  = models.FloatField()
    sharpe_ratio    = models.FloatField()
    calmar_ratio    = models.FloatField()
    max_drawdown    = models.FloatField()
    win_rate        = models.FloatField()
    turnover_rate   = models.FloatField()

    # Summary label for UI
    label           = models.CharField(max_length=128)  # "Transformer | RSI+MACD"
    created_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "benchmark_comparisons"
        ordering = ["experiment", "rank"]
