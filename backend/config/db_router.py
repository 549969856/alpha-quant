"""
config/db_router.py

Routes market_data app models to the "timescale" database alias when
it is configured. Falls back gracefully to "default" (standard PostgreSQL)
if the timescale alias is not present — this lets the project run with
a single-database setup during development.

Django docs: https://docs.djangoproject.com/en/5.0/topics/db/multi-db/
"""
from django.conf import settings

# Only pure time-series tables should live in TimescaleDB.
_TIMESCALE_MODELS = {("market_data", "ohlcvbar")}


def _timescale_available():
    return "timescale" in settings.DATABASES


class TimeSeriesRouter:
    """
    Route selected time-series models → "timescale" DB if available,
    else fall through to "default".
    """
    @staticmethod
    def _is_timeseries_model(model) -> bool:
        key = (model._meta.app_label, model._meta.model_name)
        return key in _TIMESCALE_MODELS

    def db_for_read(self, model, **hints):
        if self._is_timeseries_model(model) and _timescale_available():
            return "timescale"
        return None   # let Django use "default"

    def db_for_write(self, model, **hints):
        if self._is_timeseries_model(model) and _timescale_available():
            return "timescale"
        return None

    def allow_relation(self, obj1, obj2, **hints):
        # Allow relations involving timeseries models.
        if self._is_timeseries_model(obj1) or self._is_timeseries_model(obj2):
            return True
        return None

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        model_key = (app_label, (model_name or "").lower())
        if model_key in _TIMESCALE_MODELS:
            return db == "timescale" if _timescale_available() else db == "default"
        # Non-timeseries models should not migrate to timescale.
        if db == "timescale" and app_label != "django_migrations":
            return False
        return None
