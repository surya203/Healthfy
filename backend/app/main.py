"""Healthify API application factory.

Do not log passwords, session tokens, password hashes, or database URLs.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.csrf import OriginGuardMiddleware
from app.errors import register_exception_handlers
from app.routers.auth import router as auth_router

logger = logging.getLogger("healthify")


def create_app() -> FastAPI:
    settings = get_settings()
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    app = FastAPI(title="Healthify API", version="0.1.0", redirect_slashes=False)
    app.state.settings = settings
    register_exception_handlers(app, test_mode=settings.app_env == "test")
    app.include_router(auth_router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.add_middleware(OriginGuardMiddleware, allowed_origins=settings.cors_origin_list)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origin_list),
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Accept"],
        expose_headers=["Retry-After"],
    )
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
