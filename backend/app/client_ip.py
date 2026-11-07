"""Immediate client IP.

X-Forwarded-For is ignored unless TRUST_X_FORWARDED_FOR is true. This only
sees the TCP peer when the process is started with `python -m app.server`
(or the equivalent uvicorn flags). Uvicorn's default proxy middleware rewrites
scope["client"] from that header for loopback clients before this function runs.
"""

from __future__ import annotations

from starlette.requests import Request


def client_ip(request: Request, *, trust_x_forwarded_for: bool) -> str:
    if trust_x_forwarded_for:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            parts = [part.strip() for part in forwarded.split(",") if part.strip()]
            if parts:
                return parts[-1][:64]
    if request.client is not None and request.client.host:
        return request.client.host[:64]
    return "unknown"
