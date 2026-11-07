"""Cookie helpers. Domain is never set. Secure follows configuration."""

from __future__ import annotations

from starlette.responses import Response

from app.config import Settings
from app.schemas import no_store_headers


def set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_ttl_seconds,
        path="/",
        secure=bool(settings.session_cookie_secure),
        httponly=True,
        samesite="lax",
    )
    for key, value in no_store_headers().items():
        response.headers[key] = value


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        secure=bool(settings.session_cookie_secure),
        httponly=True,
        samesite="lax",
    )
    for key, value in no_store_headers().items():
        response.headers[key] = value
