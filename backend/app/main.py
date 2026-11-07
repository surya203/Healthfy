"""Healthify API application factory.

Auth routes are added on top of this scaffold. This module must not log
passwords, session tokens, password hashes, or database URLs.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI

from app.config import get_settings

logger = logging.getLogger("healthify")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Healthify API", version="0.1.0", redirect_slashes=False)
    app.state.settings = settings

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    logger.info(
        "Starting Healthify API env=%s cookie=%s secure=%s cors=%s "
        "session_ttl_seconds=%s rate_limit=%s/%ss trust_x_forwarded_for=%s",
        settings.app_env,
        settings.session_cookie_name,
        settings.session_cookie_secure,
        ",".join(settings.cors_origin_list),
        settings.session_ttl_seconds,
        settings.login_rate_limit_max_failures,
        settings.login_rate_limit_window_seconds,
        settings.trust_x_forwarded_for,
    )
    return app


app = create_app()
