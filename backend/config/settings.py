from pathlib import Path
from datetime import timedelta
import os
from celery.schedules import crontab

try:
    from decouple import config
except ImportError:
    def config(k, default=None, cast=None):
        v = os.environ.get(k, default)
        return cast(v) if cast and v is not None else v

BASE_DIR   = Path(__file__).resolve().parent.parent
SECRET_KEY = config("SECRET_KEY", default="insecure-dev-key-change-in-production")
DEBUG      = config("DEBUG", default=True, cast=bool)
ALLOWED_HOSTS = ["*"]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third-party
    "rest_framework",
    "rest_framework_simplejwt",
    "corsheaders",
    "django_filters",
    "drf_spectacular",
    "django_celery_beat",
    "django_celery_results",
    # Internal apps
    "apps.users",
    "apps.market_data",
    "apps.ml_engine",
    "apps.backtest",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
]

ROOT_URLCONF     = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
AUTH_USER_MODEL  = "users.User"

TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [],
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.debug",
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]

# ── Databases ──────────────────────────────────────────────────────
_DB_URL   = config("DATABASE_URL",  default="postgres://aq_user:aq_secret@localhost:5432/alphaquant")
_TS_URL   = config("TIMESCALE_URL", default="")

def _parse_db_url(url):
    from urllib.parse import urlparse
    r = urlparse(url)
    return {
        "ENGINE":   "django.db.backends.postgresql",
        "NAME":     r.path.lstrip("/"),
        "USER":     r.username,
        "PASSWORD": r.password or "",
        "HOST":     r.hostname,
        "PORT":     str(r.port or 5432),
    }

DATABASES = {"default": _parse_db_url(_DB_URL)}
if _TS_URL:
    DATABASES["timescale"] = _parse_db_url(_TS_URL)

DATABASE_ROUTERS = ["config.db_router.TimeSeriesRouter"]

# ── Cache & Celery ─────────────────────────────────────────────────
REDIS_URL = config("REDIS_URL", default="redis://localhost:6379/0")

CACHES = {"default": {
    "BACKEND": "django.core.cache.backends.redis.RedisCache",
    "LOCATION": REDIS_URL,
}}

CELERY_BROKER_URL        = REDIS_URL
CELERY_RESULT_BACKEND    = "django-db"
CELERY_ACCEPT_CONTENT    = ["json"]
CELERY_TASK_SERIALIZER   = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE          = "Asia/Taipei"
CELERY_BEAT_SCHEDULER    = "django_celery_beat.schedulers:DatabaseScheduler"
CELERY_TASK_ROUTES = {
    "apps.market_data.tasks.*": {"queue": "data_fetch"},
    "apps.ml_engine.tasks.*":   {"queue": "training"},
    "apps.backtest.tasks.*":    {"queue": "training"},
}
CELERY_BEAT_SCHEDULE = {
    "evaluate-live-feedback-daily": {
        "task": "evaluate_all_live_feedback",
        "schedule": crontab(hour=18, minute=10),
    },
}

# ── REST Framework ─────────────────────────────────────────────────
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {"anon": "30/min", "user": "300/min"},
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME":  timedelta(hours=2),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS":  True,
}

SPECTACULAR_SETTINGS = {"TITLE": "AlphaQuant API", "VERSION": "1.0.0", "SERVE_INCLUDE_SCHEMA": False}

# ── CORS ───────────────────────────────────────────────────────────
CORS_ALLOW_ALL_ORIGINS = True

# ── Static / Media ─────────────────────────────────────────────────
STATIC_URL  = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL   = "/media/"
MEDIA_ROOT  = BASE_DIR / "media"
MODEL_ARTIFACTS_DIR = config("MODEL_ARTIFACTS_DIR", default=str(BASE_DIR / "artifacts"))

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
LANGUAGE_CODE = "zh-hant"
TIME_ZONE     = "Asia/Taipei"
USE_TZ        = True
