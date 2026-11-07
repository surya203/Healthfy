import logging
import threading
from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from tests.helpers import (
    PASSWORD,
    assert_cookie_attributes,
    assert_user,
    failure_count,
    login_body,
    registration,
    reload,
    send_session,
    session_token,
    set_cookie_values,
)

from app.main import create_app
from app.models import User, UserSession


def test_register_logs_in_and_returns_normalized_user(client: TestClient, db) -> None:
    response = client.post(
        "/auth/register",
        json=registration(name="  Ada Lovelace  ", email="  Ada@Example.COM "),
    )
    assert response.status_code == 201
    assert_user(response.json(), name="Ada Lovelace", email="ada@example.com")
    token = session_token(response)
    assert token not in response.text
    assert "password" not in response.json()["user"]
    assert_cookie_attributes(set_cookie_values(response)[0], secure=False, max_age="604800")
    assert response.headers["cache-control"] == "no-store"
    me = client.get("/auth/me")
    assert me.status_code == 200
    assert me.json()["user"]["email"] == "ada@example.com"
    reload(db)
    user = db.scalar(select(User))
    assert user is not None
    assert user.password_hash.startswith("$argon2id$v=19$m=65536,t=3,p=4$")
    assert user.password_hash != PASSWORD
    assert PASSWORD not in user.password_hash


def test_duplicate_normalized_email_is_conflict(client: TestClient) -> None:
    assert client.post("/auth/register", json=registration()).status_code == 201
    response = client.post(
        "/auth/register",
        json=registration(name="Other", email=" ADA@example.com "),
    )
    assert response.status_code == 409
    assert response.json() == {
        "error": {
            "code": "EMAIL_ALREADY_EXISTS",
            "message": "An account with this email already exists.",
        }
    }
    assert "ada@example.com" not in response.text
    assert PASSWORD not in response.text


def test_concurrent_register_returns_one_success_and_one_conflict() -> None:
    barrier = threading.Barrier(2)
    statuses: list[int] = []

    def worker() -> None:
        with TestClient(create_app()) as local:
            barrier.wait(timeout=10)
            response = local.post("/auth/register", json=registration(email="race@example.com"))
            statuses.append(response.status_code)

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert sorted(statuses) == [201, 409]


def test_login_unknown_and_wrong_password_are_identical(client: TestClient) -> None:
    assert client.post("/auth/register", json=registration()).status_code == 201
    client.cookies.clear()
    unknown = client.post(
        "/auth/login",
        json=login_body(email="missing@example.com", password="wrong-password"),
    )
    wrong = client.post("/auth/login", json=login_body(password="wrong-password"))
    assert unknown.status_code == 401
    assert (
        unknown.json()
        == wrong.json()
        == {"error": {"code": "INVALID_CREDENTIALS", "message": "Invalid email or password."}}
    )
    assert "details" not in unknown.json()["error"]
    assert set_cookie_values(unknown) == []
    assert "wrong-password" not in unknown.text


def test_login_normalizes_email_and_issues_a_new_session(client: TestClient, db) -> None:
    created = client.post("/auth/register", json=registration())
    first = session_token(created)
    client.cookies.clear()
    response = client.post("/auth/login", json=login_body(email="ADA@example.com"))
    assert response.status_code == 200
    assert_user(response.json(), name="Ada Lovelace", email="ada@example.com")
    second = session_token(response)
    assert second != first
    send_session(client, first)
    assert client.get("/auth/me").status_code == 200
    send_session(client, second)
    assert client.get("/auth/me").status_code == 200
    logout = client.post("/auth/logout")
    assert logout.status_code == 204
    assert logout.content == b""
    send_session(client, first)
    assert client.get("/auth/me").status_code == 200
    send_session(client, second)
    assert client.get("/auth/me").status_code == 401
    reload(db)
    revoked = db.scalar(select(func.count()).select_from(UserSession).where(UserSession.revoked_at.is_not(None)))
    active = db.scalar(select(func.count()).select_from(UserSession).where(UserSession.revoked_at.is_(None)))
    assert revoked == 1
    assert active == 1


def test_logout_is_idempotent_without_a_session(client: TestClient) -> None:
    first = client.post("/auth/logout")
    second = client.post("/auth/logout")
    assert first.status_code == second.status_code == 204
    assert first.content == second.content == b""
    assert "max-age=0" in set_cookie_values(first)[0].lower()
    assert client.get("/auth/me").status_code == 401
    assert client.get("/auth/me").json() == {
        "error": {"code": "UNAUTHENTICATED", "message": "Authentication required."}
    }


def test_me_rejects_missing_revoked_and_expired_sessions(client: TestClient, db) -> None:
    missing = client.get("/auth/me")
    assert missing.status_code == 401
    assert client.post("/auth/register", json=registration()).status_code == 201
    db.execute(text("UPDATE sessions SET revoked_at = TIMESTAMPTZ '2000-01-01T00:00:00Z'"))
    db.commit()
    revoked = client.get("/auth/me")
    assert revoked.status_code == 401
    assert revoked.json() == missing.json()
    db.execute(text("UPDATE sessions SET revoked_at = NULL, expires_at = TIMESTAMPTZ '2000-01-01T00:00:00Z'"))
    db.commit()
    expired = client.get("/auth/me")
    assert expired.status_code == 401
    assert expired.json() == missing.json()


def test_session_expiry_follows_the_clock_and_does_not_slide(client: TestClient, clock, db) -> None:
    assert client.post("/auth/register", json=registration()).status_code == 201
    reload(db)
    session = db.scalar(select(UserSession))
    assert session is not None
    assert session.expires_at - session.created_at == timedelta(days=7)
    original_expiry = session.expires_at
    assert client.get("/auth/me").status_code == 200
    reload(db)
    session = db.scalar(select(UserSession))
    assert session is not None
    assert session.expires_at == original_expiry
    clock.advance(seconds=604799)
    assert client.get("/auth/me").status_code == 200
    clock.advance(seconds=1)
    assert client.get("/auth/me").status_code == 401


def test_input_and_password_boundaries(client: TestClient, db) -> None:
    missing = client.post("/auth/register", json={})
    assert missing.status_code == 422
    assert missing.json() == {
        "error": {
            "code": "VALIDATION_ERROR",
            "message": "Invalid input.",
            "details": {
                "fields": [
                    {"field": "name", "message": "Name is required."},
                    {"field": "email", "message": "Email is required."},
                    {"field": "password", "message": "Password is required."},
                ]
            },
        }
    }
    short = client.post("/auth/register", json=registration(password="s3cret"))
    assert short.status_code == 422
    assert "s3cret" not in short.text
    assert short.json()["error"]["details"]["fields"] == [
        {"field": "password", "message": "Password must be at least 8 characters."}
    ]
    assert client.post("/auth/register", json=registration(password="a" * 129)).status_code == 422
    assert client.post("/auth/register", json=registration(name="   ")).status_code == 422
    assert client.post("/auth/register", json=registration(name="A" * 101)).status_code == 422
    assert client.post("/auth/register", json=registration(name="Ann\nLovelace")).status_code == 422
    assert client.post("/auth/register", json=registration(email="not-an-email")).status_code == 422
    long_email = client.post("/auth/register", json=registration(email="a" * 255))
    assert long_email.status_code == 422
    assert long_email.json()["error"]["details"]["fields"][0]["message"] == ("Email must be at most 254 characters.")
    wrong_type = client.post(
        "/auth/register",
        json={"name": "Ada Lovelace", "email": "ada@example.com", "password": 12345678},
    )
    assert wrong_type.status_code == 422
    assert "12345678" not in wrong_type.text
    short_ok = client.post(
        "/auth/register",
        json=registration(password="a" * 8, email="short@example.com"),
    )
    assert short_ok.status_code == 201
    assert (
        client.post(
            "/auth/register",
            json=registration(name="A" * 100, email="long-name@example.com", password="a" * 128),
        ).status_code
        == 201
    )
    not_json = client.post(
        "/auth/register",
        content=b"{",
        headers={"Content-Type": "application/json"},
    )
    assert not_json.status_code == 422
    assert not_json.json()["error"]["details"]["fields"][0]["field"] == "body"
    assert failure_count(db) == 0


def test_login_short_password_is_validation_not_credentials(client: TestClient) -> None:
    response = client.post("/auth/login", json=login_body(password="s3cret"))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert "s3cret" not in response.text


def test_failed_login_does_not_log_the_password(client: TestClient, caplog) -> None:
    caplog.set_level(logging.DEBUG)
    password = "super-secret-password"
    client.post("/auth/login", json=login_body(email="missing@example.com", password=password))
    assert password not in caplog.text


def test_unknown_routes_use_the_error_envelope(client: TestClient) -> None:
    missing = client.get("/missing")
    assert missing.status_code == 404
    assert missing.json() == {"error": {"code": "NOT_FOUND", "message": "Not found."}}
    method = client.get("/auth/login")
    assert method.status_code == 405
    assert method.json() == {"error": {"code": "METHOD_NOT_ALLOWED", "message": "Method not allowed."}}
