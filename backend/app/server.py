"""Supported API process.

Uvicorn otherwise installs ProxyHeadersMiddleware and trusts 127.0.0.1 and ::1
(or $FORWARDED_ALLOW_IPS). That rewrites scope["client"] from X-Forwarded-For
before this app reads TRUST_X_FORWARDED_FOR. This module is the startup path
that keeps the TCP peer intact.

Do not enable uvicorn --proxy-headers. Render's Python runtime sets
FORWARDED_ALLOW_IPS=* which would make that middleware trust client-supplied
forwarded addresses. This module always passes proxy_headers=False and an
empty forwarded allow-list, ignoring that environment variable.

Per-client identity on Render is TRUSTED_PROXY_MODE, not X-Forwarded-For.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import uvicorn

logger = logging.getLogger("healthify")
_BACKEND_ROOT = Path(__file__).resolve().parents[1]


def migrations_enabled() -> bool:
    return os.environ.get("RUN_MIGRATIONS", "") in {"1", "true", "True"}


def run_migrations() -> None:
    from alembic import command
    from alembic.config import Config

    command.upgrade(Config(str(_BACKEND_ROOT / "alembic.ini")), "head")


def uvicorn_config() -> dict[str, object]:
    reload = os.environ.get("UVICORN_RELOAD", "") in {"1", "true", "True"}
    return {
        "app": "app.main:app",
        "host": os.environ.get("HOST", "127.0.0.1"),
        "port": int(os.environ.get("PORT", "8000")),
        "reload": reload,
        "proxy_headers": False,
        "forwarded_allow_ips": "",
    }


def main() -> None:
    if migrations_enabled():
        logger.info("Applying Alembic migrations before bind")
        run_migrations()
    config = uvicorn_config()
    logger.info(
        "Starting uvicorn host=%s port=%s proxy_headers=false forwarded_allow_ips=empty reload=%s",
        config["host"],
        config["port"],
        config["reload"],
    )
    uvicorn.run(**config)


if __name__ == "__main__":
    main()
