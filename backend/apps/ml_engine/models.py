"""
apps/ml_engine/models.py
Experiment → TrainingRun → ModelArtifact → Prediction
"""
import uuid
from django.db import models


class ModelRegistry(models.Model):
    """
    Catalog of supported model architectures.
    New model types are registered here — no code changes needed in API.
    """
    ARCH_CHOICES = [
        ("transformer",  "Alpha Transformer"),
        ("lstm",         "LSTM"),
        ("gru",          "GRU"),
        ("tcn",          "Temporal Conv Net"),
        ("xgboost",      "XGBoost"),
        ("lightgbm",     "LightGBM"),
        ("ensemble",     "Ensemble"),
    ]
    id              = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    arch            = models.CharField(max_length=32, choices=ARCH_CHOICES, unique=True)
    display_name    = models.CharField(max_length=64)
    description     = models.TextField()
    default_hparams = models.JSONField(default=dict)
    is_active       = models.BooleanField(default=True)

    class Meta:
        db_table = "model_registry"


class Experiment(models.Model):
    """
    Top-level container grouping multiple training runs.
    A user creates one Experiment per research question.
    """
    STATUS = [
        ("draft",    "Draft"),
        ("queued",   "Queued"),
        ("running",  "Running"),
        ("done",     "Done"),
        ("failed",   "Failed"),
    ]
    id          = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user        = models.ForeignKey("users.User", on_delete=models.CASCADE, related_name="experiments")
    name        = models.CharField(max_length=128)
    description = models.TextField(blank=True)
    ticker      = models.CharField(max_length=20)
    benchmark   = models.CharField(max_length=20, default="0050.TW")
    date_start  = models.DateField()
    date_end    = models.DateField()
    status      = models.CharField(max_length=16, choices=STATUS, default="draft")
    # Selected features
    feature_preset  = models.ForeignKey(
        "market_data.FeaturePreset", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="experiments"
    )
    feature_ids = models.JSONField(default=list, help_text="List of FeatureDefinition UUIDs")
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "experiments"
        ordering = ["-created_at"]


class TrainingRun(models.Model):
    """
    One training run within an Experiment — specific model + hparams.
    Multiple runs per experiment enable ablation studies.
    """
    STATUS = [
        ("pending",  "Pending"),
        ("training", "Training"),
        ("done",     "Done"),
        ("failed",   "Failed"),
    ]
    id           = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    experiment   = models.ForeignKey(Experiment, on_delete=models.CASCADE, related_name="runs")
    model_arch   = models.ForeignKey(ModelRegistry, on_delete=models.PROTECT)
    hparams      = models.JSONField(default=dict, help_text="Hyperparameters used")
    status       = models.CharField(max_length=16, choices=STATUS, default="pending")
    celery_task_id = models.CharField(max_length=64, blank=True)

    # Training metadata
    train_size   = models.IntegerField(null=True)
    test_size    = models.IntegerField(null=True)
    epochs_done  = models.IntegerField(default=0)
    loss_history = models.JSONField(default=list)  # [{epoch, loss}]

    started_at   = models.DateTimeField(null=True)
    finished_at  = models.DateTimeField(null=True)
    error_msg    = models.TextField(blank=True)

    class Meta:
        db_table = "training_runs"
        ordering = ["-started_at"]


class ModelArtifact(models.Model):
    """
    Serialized model weights + scaler, tied to a TrainingRun.
    `artifact_path` points to the .pt / .pkl file on disk (or S3).
    """
    id           = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run          = models.OneToOneField(TrainingRun, on_delete=models.CASCADE, related_name="artifact")
    artifact_path = models.CharField(max_length=512)
    scaler_path  = models.CharField(max_length=512, blank=True)
    model_size_kb = models.IntegerField(default=0)
    created_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "model_artifacts"


class BacktestResult(models.Model):
    """
    Full backtest results for a TrainingRun.
    Equity curve stored as compressed JSON array.
    """
    id             = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run            = models.OneToOneField(TrainingRun, on_delete=models.CASCADE, related_name="backtest")

    # Core metrics
    total_return   = models.FloatField()
    bh_return      = models.FloatField()
    annualized_ret = models.FloatField()
    sharpe_ratio   = models.FloatField()
    calmar_ratio   = models.FloatField()
    max_drawdown   = models.FloatField()
    win_rate       = models.FloatField()
    turnover_rate  = models.FloatField()

    # Curve data (for chart rendering)
    equity_curve   = models.JSONField()   # [{"date":"2024-01-02","value":1.05}, ...]
    bh_curve       = models.JSONField()
    drawdown_curve = models.JSONField()
    position_log   = models.JSONField()   # [{"date":"...","position":1}, ...]

    computed_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "backtest_results"


class PredictionRecord(models.Model):
    """
    Daily inference output.
    One row per (run, prediction_date) = tomorrow's signal.
    """
    SIGNAL_CHOICES = [("LONG","Long"),("SHORT","Short"),("NEUTRAL","Neutral")]

    id             = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run            = models.ForeignKey(TrainingRun, on_delete=models.CASCADE, related_name="predictions")
    prediction_date = models.DateField(db_index=True)     # The day this was generated
    target_date    = models.DateField()                    # T+1: the trading day to act on

    signal         = models.CharField(max_length=8, choices=SIGNAL_CHOICES)
    prob_long      = models.FloatField()
    prob_short     = models.FloatField()
    prob_neutral   = models.FloatField()
    confidence     = models.FloatField()

    # Market context at prediction time
    rsi_14         = models.FloatField(null=True)
    vol_ann        = models.FloatField(null=True)
    stop_loss_pct  = models.FloatField(null=True)
    target_pct     = models.FloatField(null=True)

    created_at     = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table        = "prediction_records"
        unique_together = [("run", "prediction_date")]
        ordering        = ["-prediction_date"]


# ─── System Logs ──────────────────────────────────────────────────────
class SystemLog(models.Model):
    """Structured application event log."""
    LEVEL_CHOICES = [("DEBUG","Debug"),("INFO","Info"),("WARNING","Warning"),("ERROR","Error")]

    id         = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    level      = models.CharField(max_length=8,  choices=LEVEL_CHOICES, default="INFO")
    component  = models.CharField(max_length=64, db_index=True)  # "ml_engine", "data_fetch"
    message    = models.TextField()
    context    = models.JSONField(default=dict)
    user       = models.ForeignKey("users.User", null=True, blank=True,
                                   on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "system_logs"
        ordering = ["-created_at"]
        indexes  = [models.Index(fields=["component", "-created_at"])]
