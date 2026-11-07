"""Runtime configuration. Defaults match the published local contract."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal, Self
from urllib.parse import parse_qsl, urlsplit

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_PRODUCTION_SSL_MODES = frozenset({"require", "verify-ca", "verify-full"})

REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = REPO_ROOT / ".env"


def normalize_database_url(value: str) -> str:
    """Use the psycopg v3 driver without dropping Neon SSL query parameters.

    Neon console strings start with postgresql:// and include sslmode=require.
    SQLAlchemy would otherwise select the psycopg2 dialect for that scheme.
    """

    stripped = value.strip()
    if stripped.startswith("postgres://"):
        stripped = "postgresql://" + stripped[len("postgres://") :]
    if stripped.startswith("postgresql://"):
        stripped = "postgresql+psycopg://" + stripped[len("postgresql://") :]
    return stripped


def database_ssl_mode(url: str) -> str:
    query = dict(parse_qsl(urlsplit(url).query, keep_blank_values=True))
    return query.get("sslmode", "")


def parse_cors_origins(value: str) -> list[str]:
    origins: list[str] = []
    for part in value.split(","):
        origin = part.strip()
        if not origin:
            continue
        if origin == "*":
            raise ValueError("CORS_ORIGINS must not include '*'.")
        if any(character.isspace() for character in origin):
            raise ValueError("Each CORS origin must be an exact origin without internal spaces.")
        origins.append(origin)
    if not origins:
        raise ValueError("CORS_ORIGINS must include at least one origin.")
    return origins


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE) if ENV_FILE.exists() else None,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: Literal["development", "test", "production"] = "development"
    database_url: str = "postgresql+psycopg://healthify:healthify@localhost:5432/healthify"
    cors_origins: str = "http://localhost:5173"
    session_cookie_name: str = "healthify_session"
    session_ttl_seconds: int = 604800
    session_cookie_secure: bool | None = None
    login_rate_limit_max_failures: int = 5
    login_rate_limit_window_seconds: int = 900
    trust_x_forwarded_for: bool = False
    trusted_proxy_mode: bool = False
    trusted_proxy_secret: str = ""
    cors_origin_list: list[str] = Field(default_factory=list, exclude=True)

    @model_validator(mode="after")
    def enforce_safe_defaults(self) -> Self:
        self.database_url = normalize_database_url(self.database_url)
        self.cors_origin_list = parse_cors_origins(self.cors_origins)
        if self.trusted_proxy_mode and self.trust_x_forwarded_for:
            raise ValueError("TRUSTED_PROXY_MODE and TRUST_X_FORWARDED_FOR cannot both be true.")
        if self.trusted_proxy_mode and len(self.trusted_proxy_secret) < 32:
            raise ValueError("TRUSTED_PROXY_SECRET must be at least 32 characters when TRUSTED_PROXY_MODE is true.")
        if self.app_env == "production" and database_ssl_mode(self.database_url) not in _PRODUCTION_SSL_MODES:
            raise ValueError(
                "DATABASE_URL must include sslmode=require, verify-ca, or verify-full when APP_ENV=production."
            )
        if self.session_cookie_secure is None:
            self.session_cookie_secure = self.app_env == "production"
        if self.app_env == "production" and not self.session_cookie_secure:
            raise ValueError("SESSION_COOKIE_SECURE must be true when APP_ENV=production.")
        if self.session_ttl_seconds <= 0:
            raise ValueError("SESSION_TTL_SECONDS must be positive.")
        if self.login_rate_limit_max_failures < 1:
            raise ValueError("LOGIN_RATE_LIMIT_MAX_FAILURES must be at least 1.")
        if self.login_rate_limit_window_seconds <= 0:
            raise ValueError("LOGIN_RATE_LIMIT_WINDOW_SECONDS must be positive.")
        if not self.session_cookie_name or any(character.isspace() for character in self.session_cookie_name):
            raise ValueError("SESSION_COOKIE_NAME must be a non-empty token without spaces.")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
