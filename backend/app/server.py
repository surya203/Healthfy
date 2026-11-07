"""Supported API process.

Uvicorn otherwise installs ProxyHeadersMiddleware and trusts 127.0.0.1 and ::1
(or $FORWARDED_ALLOW_IPS). That rewrites scope["client"] from X-Forwarded-For
before this app reads TRUST_X_FORWARDED_FOR. This module is the startup path
that keeps the TCP peer intact.

Do not enable uvicorn --proxy-headers in production. The only supported way to
honor X-Forwarded-For is TRUST_X_FORWARDED_FOR=true, with the app reachable
only from the proxy that appends the client address.
"""

from __future__ import annotations

import logging
import os

import uvicorn

logger = logging.getLogger("healthify")


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
