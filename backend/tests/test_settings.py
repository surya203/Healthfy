import pytest

from app.config import Settings, get_settings

CONTRACT_ENV_KEYS = (
    "APP_ENV",
    "DATABASE_URL",
    "CORS_ORIGINS",
    "SESSION_COOKIE_NAME",
    "SESSION_TTL_SECONDS",
    "SESSION_COOKIE_SECURE",
    "LOGIN_RATE_LIMIT_MAX_FAILURES",
    "LOGIN_RATE_LIMIT_WINDOW_SECONDS",
    "TRUST_X_FORWARDED_FOR",
    "TRUSTED_PROXY_MODE",
    "TRUSTED_PROXY_SECRET",
    "RUN_MIGRATIONS",
    "HOST",
    "PORT",
    "FORWARDED_ALLOW_IPS",
)


@pytest.fixture
def isolated_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in CONTRACT_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_contract_defaults(isolated_env: None) -> None:
    settings = Settings(_env_file=None)
    assert settings.app_env == "development"
    assert settings.database_url == ("postgresql+psycopg://healthify:healthify@localhost:5432/healthify")
    assert settings.cors_origin_list == ["http://localhost:5173"]
    assert settings.session_cookie_name == "healthify_session"
    assert settings.session_ttl_seconds == 604800
    assert settings.session_cookie_secure is False
    assert settings.login_rate_limit_max_failures == 5
    assert settings.login_rate_limit_window_seconds == 900
    assert settings.trust_x_forwarded_for is False
    assert settings.trusted_proxy_mode is False
    assert settings.trusted_proxy_secret == ""


def test_cors_origins_are_trimmed_and_wildcard_is_rejected(isolated_env: None) -> None:
    settings = Settings(
        _env_file=None,
        cors_origins="http://localhost:5173, https://app.example.com",
    )
    assert settings.cors_origin_list == [
        "http://localhost:5173",
        "https://app.example.com",
    ]
    with pytest.raises(ValueError, match="must not include"):
        Settings(_env_file=None, cors_origins="*")
    with pytest.raises(ValueError, match="at least one"):
        Settings(_env_file=None, cors_origins=" , ")


_PRODUCTION_DATABASE_URL = (
    "postgresql://placeholder:placeholder@ep-example.region.aws.neon.tech/neondb"
    "?sslmode=require&channel_binding=require"
)


def test_production_cookie_must_be_secure(isolated_env: None) -> None:
    with pytest.raises(ValueError, match="SESSION_COOKIE_SECURE"):
        Settings(
            _env_file=None,
            app_env="production",
            session_cookie_secure=False,
            database_url=_PRODUCTION_DATABASE_URL,
        )
    settings = Settings(_env_file=None, app_env="production", database_url=_PRODUCTION_DATABASE_URL)
    assert settings.session_cookie_secure is True
    assert settings.database_url.startswith("postgresql+psycopg://")
    assert "sslmode=require" in settings.database_url
    assert "channel_binding=require" in settings.database_url
    assert "placeholder:placeholder" in settings.database_url


def test_production_database_url_requires_ssl_and_proxy_modes_do_not_combine(isolated_env: None) -> None:
    with pytest.raises(ValueError, match="sslmode"):
        Settings(_env_file=None, app_env="production", database_url="postgresql+psycopg://u:p@localhost/db")
    with pytest.raises(ValueError, match="cannot both"):
        Settings(
            _env_file=None,
            trusted_proxy_mode=True,
            trust_x_forwarded_for=True,
            trusted_proxy_secret="s" * 32,
        )
    with pytest.raises(ValueError, match="TRUSTED_PROXY_SECRET"):
        Settings(_env_file=None, trusted_proxy_mode=True, trusted_proxy_secret="short")
