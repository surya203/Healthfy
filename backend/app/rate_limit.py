"""PostgreSQL-backed login failure window. Not an in-memory counter."""

from __future__ import annotations

import math
from datetime import datetime, timedelta

from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import LoginFailure


def lock_client_ip(db: Session, client_ip: str) -> None:
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:ip))"), {"ip": client_ip})


def _window_cutoff(now: datetime, settings: Settings) -> datetime:
    return now - timedelta(seconds=settings.login_rate_limit_window_seconds)


def failure_timestamps(db: Session, client_ip: str, now: datetime, settings: Settings) -> list[datetime]:
    cutoff = _window_cutoff(now, settings)
    db.execute(
        delete(LoginFailure).where(
            LoginFailure.client_ip == client_ip,
            LoginFailure.attempted_at <= cutoff,
        )
    )
    rows = db.scalars(
        select(LoginFailure.attempted_at)
        .where(LoginFailure.client_ip == client_ip, LoginFailure.attempted_at > cutoff)
        .order_by(LoginFailure.attempted_at.asc())
    ).all()
    return list(rows)


def retry_after_seconds(timestamps: list[datetime], now: datetime, settings: Settings) -> int:
    limit = settings.login_rate_limit_max_failures
    if len(timestamps) < limit:
        return 0
    window = timedelta(seconds=settings.login_rate_limit_window_seconds)
    index = len(timestamps) - limit
    boundary = timestamps[index] + window
    seconds = math.ceil((boundary - now).total_seconds())
    return max(1, int(seconds))


def record_failure(db: Session, client_ip: str, now: datetime) -> None:
    db.add(LoginFailure(client_ip=client_ip, attempted_at=now))
