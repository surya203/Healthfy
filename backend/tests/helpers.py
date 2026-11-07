from __future__ import annotations

import re

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import LoginFailure

PASSWORD = "correct-horse"
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
CREATED_AT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")


def registration(**overrides: str) -> dict[str, str]:
    body = {"name": "Ada Lovelace", "email": "ada@example.com", "password": PASSWORD}
    body.update(overrides)
    return body


def login_body(**overrides: str) -> dict[str, str]:
    body = {"email": "ada@example.com", "password": PASSWORD}
    body.update(overrides)
    return body


def set_cookie_values(response) -> list[str]:
    return response.headers.get_list("set-cookie")


def session_token(response) -> str:
    headers = set_cookie_values(response)
    assert headers, "expected a Set-Cookie header"
    pair = headers[0].split(";", 1)[0]
    name, value = pair.split("=", 1)
    assert name == "healthify_session"
    assert value
    return value


def assert_cookie_attributes(header: str, *, secure: bool, max_age: str) -> None:
    attributes = header.split(";", 1)[1].lower()
    assert "httponly" in attributes
    assert "samesite=lax" in attributes
    assert "path=/" in attributes
    assert "domain" not in attributes
    assert f"max-age={max_age}" in attributes
    if secure:
        assert "secure" in attributes
    else:
        assert "secure" not in attributes


def assert_user(body: dict, *, name: str, email: str) -> None:
    assert set(body) == {"user"}
    user = body["user"]
    assert set(user) == {"id", "name", "email", "created_at"}
    assert UUID_RE.match(user["id"])
    assert user["name"] == name
    assert user["email"] == email
    assert CREATED_AT_RE.match(user["created_at"])


def reload(db: Session) -> None:
    db.rollback()
    db.expire_all()


def failure_count(db: Session) -> int:
    reload(db)
    return int(db.scalar(select(func.count()).select_from(LoginFailure)) or 0)


def send_session(client: TestClient, token: str):
    client.cookies.clear()
    client.cookies.set("healthify_session", token)
