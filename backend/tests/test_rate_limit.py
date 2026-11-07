from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select
from tests.helpers import failure_count, login_body, registration, reload

from app.config import get_settings
from app.main import create_app
from app.models import LoginFailure


def test_first_five_failures_then_sixth_is_limited(client: TestClient, db) -> None:
    body = login_body(email="missing@example.com", password="wrong-password")
    for attempt in range(5):
        response = client.post("/auth/login", json=body)
        assert response.status_code == 401, attempt
        assert response.json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert failure_count(db) == 5
    blocked = client.post("/auth/login", json=body)
    assert blocked.status_code == 429
    assert blocked.json() == {
        "error": {
            "code": "RATE_LIMITED",
            "message": "Too many login attempts. Try again later.",
        }
    }
    retry_after = int(blocked.headers["retry-after"])
    assert 1 <= retry_after <= 900
    assert "wrong-password" not in blocked.text
    assert failure_count(db) == 5
    assert client.post("/auth/login", json=body).status_code == 429
    assert failure_count(db) == 5


def test_successful_login_does_not_reset_failures(client: TestClient, db) -> None:
    assert client.post("/auth/register", json=registration()).status_code == 201
    client.cookies.clear()
    for _ in range(3):
        response = client.post("/auth/login", json=login_body(password="wrong-password"))
        assert response.status_code == 401
    assert failure_count(db) == 3
    success = client.post("/auth/login", json=login_body())
    assert success.status_code == 200
    assert failure_count(db) == 3
    client.cookies.clear()
    for _ in range(2):
        response = client.post("/auth/login", json=login_body(password="wrong-password"))
        assert response.status_code == 401
    assert failure_count(db) == 5
    blocked = client.post("/auth/login", json=login_body())
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) >= 1
    assert failure_count(db) == 5


def test_validation_and_origin_failures_do_not_count(client: TestClient, db) -> None:
    wrong = login_body(password="wrong-password")
    for _ in range(4):
        assert client.post("/auth/login", json=wrong).status_code == 401
    for _ in range(3):
        short = client.post("/auth/login", json=login_body(password="s3cret"))
        assert short.status_code == 422
    forbidden = client.post(
        "/auth/login",
        json=wrong,
        headers={"Origin": "https://evil.example"},
    )
    assert forbidden.status_code == 403
    assert failure_count(db) == 4
    assert client.post("/auth/login", json=wrong).status_code == 401
    assert failure_count(db) == 5
    assert client.post("/auth/login", json=wrong).status_code == 429


def test_seeded_window_retry_after_and_exact_expiry(client: TestClient, clock, seed_login_failures, db) -> None:
    start = clock.now()
    seed_login_failures("testclient", start, count=5)
    clock.advance(seconds=100)
    blocked = client.post("/auth/login", json=login_body(password="wrong-password"))
    assert blocked.status_code == 429
    assert blocked.headers["retry-after"] == "800"
    assert failure_count(db) == 5
    clock.set(start + timedelta(seconds=900))
    allowed = client.post("/auth/login", json=login_body(password="wrong-password"))
    assert allowed.status_code == 401
    assert failure_count(db) == 1


def test_forwarded_for_is_ignored_unless_explicitly_trusted(client: TestClient, db, monkeypatch) -> None:
    spoofed = {"X-Forwarded-For": "198.51.100.9, 192.0.2.15"}
    response = client.post(
        "/auth/login",
        json=login_body(email="missing@example.com", password="wrong-password"),
        headers=spoofed,
    )
    assert response.status_code == 401
    reload(db)
    assert list(db.scalars(select(LoginFailure.client_ip))) == ["testclient"]

    monkeypatch.setenv("TRUST_X_FORWARDED_FOR", "true")
    get_settings.cache_clear()
    try:
        with TestClient(create_app()) as trusted:
            trusted_response = trusted.post(
                "/auth/login",
                json=login_body(email="other@example.com", password="wrong-password"),
                headers=spoofed,
            )
        assert trusted_response.status_code == 401
        reload(db)
        assert sorted(db.scalars(select(LoginFailure.client_ip))) == ["192.0.2.15", "testclient"]
    finally:
        get_settings.cache_clear()
