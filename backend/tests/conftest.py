"""Pytest talks only to the healthify_test database.

The clock and login-failure fixtures are in-process. There is no HTTP debug route.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://healthify:healthify@localhost:5432/healthify_test",
)
os.environ.setdefault("SESSION_COOKIE_SECURE", "false")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:5173")
os.environ.setdefault("TRUST_X_FORWARDED_FOR", "false")
os.environ.setdefault("LOGIN_RATE_LIMIT_MAX_FAILURES", "5")
os.environ.setdefault("LOGIN_RATE_LIMIT_WINDOW_SECONDS", "900")
os.environ.setdefault("SESSION_COOKIE_NAME", "healthify_session")
os.environ.setdefault("SESSION_TTL_SECONDS", "604800")

import psycopg
import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.engine.url import make_url
from sqlalchemy.orm import Session

from app.clock import configure, reset
from app.config import get_settings
from app.database import get_sessionmaker, reset_database_state
from app.main import create_app
from app.models import LoginFailure

BACKEND_ROOT = Path(__file__).resolve().parents[1]
TEST_DB_NAME = "healthify_test"
get_settings.cache_clear()


class FrozenClock:
    """Test double installed through app.clock.configure. Not reachable over HTTP."""

    def __init__(self, instant: datetime) -> None:
        self.instant = instant

    def now(self) -> datetime:
        return self.instant

    def set(self, instant: datetime) -> None:
        if instant.tzinfo is None:
            raise ValueError("clock instant must be timezone-aware")
        self.instant = instant.astimezone(UTC)

    def advance(self, *, seconds: int = 0, minutes: int = 0, days: int = 0) -> None:
        self.instant += timedelta(seconds=seconds, minutes=minutes, days=days)


def _connect(url, dbname: str, *, autocommit: bool) -> psycopg.Connection:
    return psycopg.connect(
        host=url.host or "localhost",
        port=url.port or 5432,
        user=url.username,
        password=url.password or "",
        dbname=dbname,
        autocommit=autocommit,
    )


def prepare_test_database() -> None:
    get_settings.cache_clear()
    reset_database_state()
    url = make_url(get_settings().database_url)
    if url.database != TEST_DB_NAME:
        raise RuntimeError(
            f"Refusing to run tests against database {url.database!r}. "
            f"Set DATABASE_URL to a database named {TEST_DB_NAME}. "
            "Tests drop schema public on that database."
        )
    admin = None
    last_error: Exception | None = None
    for maintenance in ("postgres", "healthify"):
        try:
            admin = _connect(url, maintenance, autocommit=True)
            break
        except Exception as exc:
            last_error = exc
    if admin is None:
        raise RuntimeError(f"Could not connect to PostgreSQL to prepare {TEST_DB_NAME}: {last_error}")
    with admin:
        with admin.cursor() as cursor:
            cursor.execute("SELECT 1 FROM pg_database WHERE datname = %s", (TEST_DB_NAME,))
            if cursor.fetchone() is None:
                cursor.execute(f'CREATE DATABASE "{TEST_DB_NAME}"')
    with _connect(url, TEST_DB_NAME, autocommit=True) as conn:
        with conn.cursor() as cursor:
            cursor.execute("DROP SCHEMA IF EXISTS public CASCADE")
            cursor.execute("CREATE SCHEMA public")
            cursor.execute("GRANT ALL ON SCHEMA public TO CURRENT_USER")
            cursor.execute("GRANT ALL ON SCHEMA public TO public")
    command.upgrade(Config(str(BACKEND_ROOT / "alembic.ini")), "head")


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> Iterator[None]:
    prepare_test_database()
    yield
    reset_database_state()


@pytest.fixture(autouse=True)
def clean_tables(migrated_database: None) -> Iterator[None]:
    session = get_sessionmaker()()
    try:
        session.execute(text("TRUNCATE TABLE login_failures, sessions, users RESTART IDENTITY CASCADE"))
        session.commit()
        yield
        session.rollback()
        session.execute(text("TRUNCATE TABLE login_failures, sessions, users RESTART IDENTITY CASCADE"))
        session.commit()
    finally:
        session.close()


@pytest.fixture
def db() -> Iterator[Session]:
    session = get_sessionmaker()()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture
def clock() -> Iterator[FrozenClock]:
    frozen = FrozenClock(datetime(2026, 1, 15, 12, 0, tzinfo=UTC))
    configure(frozen)
    try:
        yield frozen
    finally:
        reset()


@pytest.fixture
def seed_login_failures(db: Session):
    def _seed(client_ip: str, attempted_at: datetime, count: int = 1) -> None:
        if attempted_at.tzinfo is None:
            raise ValueError("attempted_at must be timezone-aware")
        for _ in range(count):
            db.add(LoginFailure(client_ip=client_ip, attempted_at=attempted_at))
        db.commit()

    return _seed
