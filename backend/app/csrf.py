"""Origin guard for unsafe browser requests. Not applied to GET, HEAD, or OPTIONS."""

from __future__ import annotations

import json
from collections.abc import Iterable

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


class OriginGuardMiddleware:
    def __init__(self, app: ASGIApp, allowed_origins: Iterable[str]) -> None:
        self.app = app
        self.allowed_origins = set(allowed_origins)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        method = str(scope.get("method", "GET")).upper()
        if method in _SAFE_METHODS:
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        origin = headers.get("origin")
        if origin is not None:
            if origin not in self.allowed_origins:
                await _forbidden(send, "Origin is not allowed.")
                return
            await self.app(scope, receive, send)
            return
        site = headers.get("sec-fetch-site")
        if site is not None and site.lower() not in {"same-origin", "none"}:
            await _forbidden(send, "Cross-site request was blocked.")
            return
        await self.app(scope, receive, send)


async def _forbidden(send: Send, message: str) -> None:
    payload = json.dumps({"error": {"code": "FORBIDDEN", "message": message}}).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": 403,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(payload)).encode("ascii")),
                (b"cache-control", b"no-store"),
            ],
        }
    )
    await send({"type": "http.response.body", "body": payload})
