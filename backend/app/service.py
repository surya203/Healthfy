"""Registration and session rules."""

from __future__ import annotations

import logging
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import clock
from app.config import Settings
from app.errors import APIError
from app.models import User, UserSession
from app.rate_limit import failure_timestamps, lock_client_ip, record_failure, retry_after_seconds
from app.schemas import as_utc
from app.security import (
    dummy_password_hash,
    hash_password,
    hash_session_token,
    new_session_token,
    verify_password,
)

INVALID_CREDENTIALS = APIError(401, "INVALID_CREDENTIALS", "Invalid email or password.")
UNAUTHENTICATED = APIError(401, "UNAUTHENTICATED", "Authentication required.")
EMAIL_TAKEN = APIError(409, "EMAIL_ALREADY_EXISTS", "An account with this email already exists.")
logger = logging.getLogger("healthify")


def _email_unique_violation(exc: IntegrityError) -> bool:
    orig = getattr(exc, "orig", None)
    diag = getattr(orig, "diag", None)
    constraint = getattr(diag, "constraint_name", None) if diag is not None else None
    if constraint == "uq_users_email":
        return True
    sqlstate = getattr(orig, "sqlstate", None)
    text = str(orig) if orig is not None else ""
    return sqlstate == "23505" and "uq_users_email" in text


def _issue_session(db: Session, user: User, settings: Settings) -> str:
    moment = clock.now()
    token = new_session_token()
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_session_token(token),
            created_at=moment,
            expires_at=moment + timedelta(seconds=settings.session_ttl_seconds),
        )
    )
    return token


def register_user(db: Session, name: str, email: str, password: str, settings: Settings) -> tuple[User, str]:
    existing = db.scalar(select(User.id).where(User.email == email))
    if existing is not None:
        raise EMAIL_TAKEN
    user = User(
        name=name,
        email=email,
        password_hash=hash_password(password),
        created_at=clock.now(),
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        if _email_unique_violation(exc):
            raise EMAIL_TAKEN from None
        logger.error(
            "registration integrity error (%s)",
            type(getattr(exc, "orig", None)).__name__,
        )
        raise APIError(500, "INTERNAL_ERROR", "Internal server error.") from None
    token = _issue_session(db, user, settings)
    db.commit()
    db.refresh(user)
    return user, token


def authenticate(
    db: Session,
    email: str,
    password: str,
    client_ip: str,
    settings: Settings,
) -> tuple[User, str]:
    moment = clock.now()
    lock_client_ip(db, client_ip)
    timestamps = failure_timestamps(db, client_ip, moment, settings)
    if len(timestamps) >= settings.login_rate_limit_max_failures:
        retry_after = retry_after_seconds(timestamps, moment, settings)
        db.commit()
        raise APIError(
            429,
            "RATE_LIMITED",
            "Too many login attempts. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        verify_password(dummy_password_hash(), password)
        record_failure(db, client_ip, moment)
        db.commit()
        raise INVALID_CREDENTIALS
    if not verify_password(user.password_hash, password):
        record_failure(db, client_ip, moment)
        db.commit()
        raise INVALID_CREDENTIALS
    token = _issue_session(db, user, settings)
    db.commit()
    return user, token


def user_for_token(db: Session, raw_token: str | None) -> User:
    if not raw_token:
        raise UNAUTHENTICATED
    moment = clock.now()
    session = db.scalar(select(UserSession).where(UserSession.token_hash == hash_session_token(raw_token)))
    if session is None or session.revoked_at is not None or as_utc(session.expires_at) <= moment:
        raise UNAUTHENTICATED
    user = db.get(User, session.user_id)
    if user is None:
        raise UNAUTHENTICATED
    return user


def revoke_current_session(db: Session, raw_token: str | None) -> None:
    if not raw_token:
        return
    session = db.scalar(select(UserSession).where(UserSession.token_hash == hash_session_token(raw_token)))
    if session is None or session.revoked_at is not None:
        return
    session.revoked_at = clock.now()
    db.commit()
