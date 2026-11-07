from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from tests.helpers import failure_count, reload

from app.config import get_settings
from app.main import create_app
from app.models import LoginFailure
from app.proxy_auth import parse_single_ip

SECRET = "t" * 32
WRONG = {"email": "ada@example.com", "password": "wrong-password"}


def test_parse_single_ip_accepts_one_address_only() -> None:
    assert parse_single_ip("203.0.113.10") == "203.0.113.10"
    assert parse_single_ip(" 2001:0db8:0000:0000:0000:0000:0000:0001 ") == "2001:db8::1"
    assert parse_single_ip("::1") == "::1"
    for malformed in (
        None,
        "",
        "   ",
        "203.0.113.10, 198.51.100.20",
        "203.0.113.10 198.51.100.20",
        "not-an-ip",
        "203.0.113.10:443",
        "[2001:db8::1]",
        "2001:db8::1%eth0",
        "203.0.113.0/24",
    ):
        assert parse_single_ip(malformed) is None


@pytest.fixture
def proxy_app(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("TRUSTED_PROXY_MODE", "true")
    monkeypatch.setenv("TRUSTED_PROXY_SECRET", SECRET)
    monkeypatch.setenv("TRUST_X_FORWARDED_FOR", "false")
    get_settings.cache_clear()
    try:
        yield create_app()
    finally:
        get_settings.cache_clear()


def _headers(ip: str, secret: str = SECRET, **extra: str) -> dict[str, str]:
    return {"X-Healthify-Proxy-Auth": secret, "X-Healthify-Client-IP": ip, **extra}


def test_untrusted_mode_ignores_proxy_headers(client: TestClient, db) -> None:
    response = client.post(
        "/auth/login",
        json=WRONG,
        headers={
            **_headers("203.0.113.10"),
            "X-Forwarded-For": "198.51.100.9",
            "X-Real-IP": "192.0.2.9",
            "X-Vercel-Forwarded-For": "203.0.113.99",
        },
    )
    assert response.status_code == 401
    reload(db)
    assert list(db.scalars(select(LoginFailure.client_ip))) == ["testclient"]


def test_direct_access_fails_closed_and_health_stays_open(proxy_app) -> None:
    with TestClient(proxy_app) as client:
        assert client.get("/health").status_code == 200
        missing = client.post("/auth/login", json=WRONG)
        assert missing.status_code == 403
        assert missing.json()["error"] == {
            "code": "FORBIDDEN",
            "message": "Proxy authentication is required.",
        }
        wrong = client.post("/auth/login", json=WRONG, headers=_headers("203.0.113.10", secret="u" * 32))
        assert wrong.status_code == 403
        malformed = client.post(
            "/auth/login",
            json=WRONG,
            headers=_headers("203.0.113.10, 198.51.100.20"),
        )
        assert malformed.status_code == 403
        assert malformed.json()["error"]["message"] == "Client IP is invalid."
        blocked_register = client.post(
            "/auth/register",
            json={"name": "A", "email": "a@example.com", "password": "wrong-password"},
        )
        assert blocked_register.status_code == 403
        assert client.get("/auth/me").status_code == 403


def test_verified_client_ips_use_separate_buckets(proxy_app, db, seed_login_failures) -> None:
    seed_login_failures("203.0.113.10", datetime.now(UTC), count=5)
    seed_login_failures("2001:db8::1", datetime.now(UTC), count=5)
    with TestClient(proxy_app) as client:
        spoofed = {
            "X-Forwarded-For": "198.51.100.77, 203.0.113.11",
            "X-Real-IP": "203.0.113.11",
            "X-Vercel-Forwarded-For": "203.0.113.11",
        }
        limited = client.post("/auth/login", json=WRONG, headers={**_headers("203.0.113.10"), **spoofed})
        assert limited.status_code == 429
        other = client.post("/auth/login", json=WRONG, headers=_headers("203.0.113.11"))
        assert other.status_code == 401
        ipv6 = client.post("/auth/login", json=WRONG, headers=_headers("2001:0db8:0000:0000:0000:0000:0000:0001"))
        assert ipv6.status_code == 429
        fresh_v6 = client.post("/auth/login", json=WRONG, headers=_headers("2001:db8::2"))
        assert fresh_v6.status_code == 401
    reload(db)
    counts = dict(db.execute(select(LoginFailure.client_ip, func.count()).group_by(LoginFailure.client_ip)).all())
    assert counts["203.0.113.10"] == 5
    assert counts["203.0.113.11"] == 1
    assert counts["2001:db8::1"] == 5
    assert counts["2001:db8::2"] == 1
    assert failure_count(db) == 12
