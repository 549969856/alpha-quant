"""
apps/market_data/models.py
OHLCV + Feature registry

NOTE on database routing:
  `using` is NOT a valid Django Meta option — routing is handled by
  config/db_router.py which sends market_data models to the "timescale"
  alias (falls back to "default" if timescale is not configured).
"""
import uuid
from django.db import models


# ─── Market Data ─────────────────────────────────────────────────────
class StockUniverse(models.Model):
    """Tradeable instrument registry."""
    ticker      = models.CharField(max_length=20, unique=True, db_index=True)
    name        = models.CharField(max_length=128)
    exchange    = models.CharField(max_length=16, default="TWSE")
    sector      = models.CharField(max_length=64, blank=True)
    is_active   = models.BooleanField(default=True)
    last_synced = models.DateTimeField(null=True)

    class Meta:
        db_table = "stock_universe"


class OHLCVBar(models.Model):
    """
    Raw daily OHLCV bar.
    Routed to "timescale" DB alias via TimeSeriesRouter;
    falls back to "default" (PostgreSQL) if timescale not configured.
    """
    ticker    = models.CharField(max_length=20, db_index=True)
    timestamp = models.DateField(db_index=True)
    open      = models.FloatField()
    high      = models.FloatField()
    low       = models.FloatField()
    close     = models.FloatField()
    adj_close = models.FloatField()
    volume    = models.BigIntegerField()

    class Meta:
        db_table        = "ohlcv_bars"
        unique_together = [("ticker", "timestamp")]
        indexes         = [models.Index(fields=["ticker", "-timestamp"])]


# ─── Feature Registry ─────────────────────────────────────────────────
class FeatureDefinition(models.Model):
    """
    Master catalog of all computable features.
    Each row describes ONE feature — its category, computation params,
    and the Python function path to compute it.
    Seeded via management command `seed_features`.
    """
    CATEGORY_CHOICES = [
        ("price_volume", "裸K價量"),
        ("momentum",     "動能/均值回歸"),
        ("trend",        "趨勢"),
        ("volatility",   "波動率"),
        ("relative",     "相對強弱"),
        ("custom",       "自定義"),
    ]

    id           = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name         = models.CharField(max_length=64, unique=True)      # e.g. "RSI_14"
    display_name = models.CharField(max_length=128)                   # UI label
    category     = models.CharField(max_length=32, choices=CATEGORY_CHOICES)
    description  = models.TextField()
    params       = models.JSONField(default=dict)                     # {"window": 14}
    compute_fn   = models.CharField(max_length=256)                   # dotted path
    is_active    = models.BooleanField(default=True)
    created_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "feature_definitions"
        ordering = ["category", "name"]

    def __str__(self):
        return self.name


class FeaturePreset(models.Model):
    """
    Saved feature combination presets.
    Users can save & reuse feature selections.
    """
    id          = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user        = models.ForeignKey("users.User", on_delete=models.CASCADE, related_name="presets")
    name        = models.CharField(max_length=64)
    description = models.TextField(blank=True)
    features    = models.ManyToManyField(FeatureDefinition, related_name="presets")
    is_public   = models.BooleanField(default=False)
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "feature_presets"
        unique_together = [("user", "name")]


class ComputedFeatureCache(models.Model):
    """
    Pre-computed feature matrix cache per (ticker, feature, date).
    Avoids redundant recomputation across experiments.
    """
    ticker     = models.CharField(max_length=20, db_index=True)
    feature    = models.ForeignKey(FeatureDefinition, on_delete=models.CASCADE)
    timestamp  = models.DateField()
    value      = models.FloatField(null=True)

    class Meta:
        db_table        = "computed_features"
        unique_together = [("ticker", "feature", "timestamp")]
        indexes         = [models.Index(fields=["ticker", "-timestamp"])]
