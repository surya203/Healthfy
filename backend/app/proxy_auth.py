"""Authenticated proxy identity for deployments behind a public edge.

Ordinary forwarded headers are not a client identity. Render's public URL is
reachable without Vercel, and Render's Python image sets FORWARDED_ALLOW_IPS=*.
When trusted proxy mode is on, only a server-side shared secret plus one
explicit client IP are accepted. Everything else fails closed, except /health,
which Render probes directly.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress

from starlette.types import ASGIApp, Receive, Scope, Send

from app.csrf import _forbidden

PROXY_AUTH_HEADER = "x-healthify-proxy-auth"
CLIENT_IP_HEADER = "x-healthify-client-ip"
_HEALTH_PATH = "/health"


def parse_single_ip(value: str | None) -> str | None:
    if value is None:
        return None
    candidate = value.strip()
    if not candidate or "," in candidate or any(character.isspace() for character in candidate):
        return None
    if candidate.startswith("[") or "/" in candidate or "%" in candidate:
        return None
    try:
        parsed = ipaddress.ip_address(candidate)
    except ValueError:
        return None
    if isinstance(parsed, ipaddress.IPv6Address):
        return parsed.compressed
    return str(parsed)


def proxy_secret_matches(provided: str, expected: str) -> bool:
    if not expected or not provided:
        return False
    provided_digest = hashlib.sha256(provided.encode("utf-8")).digest()
    expected_digest = hashlib.sha256(expected.encode("utf-8")).digest()
    return hmac.compare_digest(provided_digest, expected_digest)


class TrustedProxyMiddleware:
    def __init__(self, app: ASGIApp, *, enabled: bool, secret: str) -> None:
        self.app = app
        self.enabled = enabled
        self.secret = secret

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not self.enabled:
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        method = str(scope.get("method", "GET")).upper()
        if path == _HEALTH_PATH and method in {"GET", "HEAD"}:
            await self.app(scope, receive, send)
            return
        headers = _header_map(scope)
        if not proxy_secret_matches(headers.get(PROXY_AUTH_HEADER, ""), self.secret):
            await _forbidden(send, "Proxy authentication is required.")
            return
        client_ip = parse_single_ip(headers.get(CLIENT_IP_HEADER))
        if client_ip is None:
            await _forbidden(send, "Client IP is invalid.")
            return
        state = scope.setdefault("state", {})
        if isinstance(state, dict):
            state["verified_client_ip"] = client_ip
        await self.app(scope, receive, send)


def _header_map(scope: Scope) -> dict[str, str]:
    found: dict[str, list[str]] = {}
    for name, value in scope.get("headers", []):
        key = name.decode("latin-1").lower()
        found.setdefault(key, []).append(value.decode("latin-1"))
    flattened: dict[str, str] = {}
    for key, values in found.items():
        flattened[key] = ", ".join(values) if len(values) > 1 else values[0]
    return flattened
