# core/settings.py
from pathlib import Path
from datetime import timedelta
from decimal import Decimal
import os
# --- Paths / básicos
BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = "dev-change-me"
DEBUG = True
ALLOWED_HOSTS = ["127.0.0.1", "localhost"]
FX_USD_TO_BS = Decimal(os.getenv("FX_USD_TO_BS", "382"))
# --- Apps
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",

    "corsheaders",          # CORS
    "rest_framework",
    "django_filters",

    "inventory",
    "authapi",
]

# --- Middleware (CORS antes de CommonMiddleware)
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "corsheaders.middleware.CorsMiddleware",   # 👈 debe ir antes de CommonMiddleware
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "authapi.middleware.RefreshAccessTokenMiddleware",
]

# --- URLs / WSGI
ROOT_URLCONF = "core.urls"
WSGI_APPLICATION = "core.wsgi.application"

# --- Django Templates (necesario para admin)
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],  # opcional; puede estar vacío
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# --- DB (sqlite dev)
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

# --- i18n
LANGUAGE_CODE = "es-es"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# --- Static/Media (dev)
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"   # para collectstatic si lo necesitas
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- CORS / CSRF (DEV)
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOWED_ORIGINS = [
    "http://127.0.0.1:4200",
    "http://localhost:4200",
]
CSRF_TRUSTED_ORIGINS = [
    "http://127.0.0.1:4200",
    "http://localhost:4200",
]

# Cookies en dev: con MISMO host (localhost+localhost o 127+127), Lax funciona.
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False
CSRF_COOKIE_NAME = "csrftoken"
CSRF_HEADER_NAME = "HTTP_X_CSRFTOKEN"

# --- DRF
REST_FRAMEWORK = {
    # Solo cookie-JWT para evitar interferencias
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "authapi.auth.CookieJWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
    ],
}

# --- SimpleJWT (duraciones)
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
}


# === Archivos subidos (media) ===
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"
