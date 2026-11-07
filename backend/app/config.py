"""Runtime configuration. Defaults match the published local contract."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal, Self

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = REPO_ROOT / ".env"


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
    cors_origin_list: list[str] = Field(default_factory=list, exclude=True)

    @model_validator(mode="after")
    def enforce_safe_defaults(self) -> Self:
        self.cors_origin_list = parse_cors_origins(self.cors_origins)
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
