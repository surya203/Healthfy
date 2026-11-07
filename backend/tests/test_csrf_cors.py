from starlette.responses import Response
from tests.helpers import (
    PASSWORD,
    assert_cookie_attributes,
    login_body,
    registration,
    session_token,
    set_cookie_values,
)

from app.config import Settings
from app.cookies import set_session_cookie


def test_allowed_origin_and_non_browser_clients(client) -> None:
    allowed = client.post(
        "/auth/register",
        json=registration(),
        headers={"Origin": "http://localhost:5173"},
    )
    assert allowed.status_code == 201
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert allowed.headers["access-control-allow-credentials"] == "true"
    assert allowed.headers["access-control-allow-origin"] != "*"

    client.cookies.clear()
    omitted = client.post("/auth/login", json=login_body())
    assert omitted.status_code == 200

    same_origin = client.post(
        "/auth/logout",
        headers={"Sec-Fetch-Site": "same-origin"},
    )
    client.cookies.clear()
    # Logout above consumed the session. Log in again without Origin, then allow none.
    assert client.post("/auth/login", json=login_body()).status_code == 200
    none_site = client.post("/auth/logout", headers={"Sec-Fetch-Site": "none"})
    assert same_origin.status_code == 204
    assert none_site.status_code == 204


def test_cross_site_origin_is_forbidden_and_does_not_mutate(client) -> None:
    assert client.post("/auth/register", json=registration()).status_code == 201
    evil = {"Origin": "https://evil.example"}
    blocked_login = client.post("/auth/login", json=login_body(), headers=evil)
    assert blocked_login.status_code == 403
    assert blocked_login.json() == {"error": {"code": "FORBIDDEN", "message": "Origin is not allowed."}}
    assert "access-control-allow-origin" not in blocked_login.headers
    assert PASSWORD not in blocked_login.text
    blocked_logout = client.post("/auth/logout", headers=evil)
    assert blocked_logout.status_code == 403
    me = client.get("/auth/me")
    assert me.status_code == 200
    cross_site = client.post("/auth/login", json=login_body(), headers={"Sec-Fetch-Site": "cross-site"})
    assert cross_site.status_code == 403
    assert cross_site.json()["error"]["message"] == "Cross-site request was blocked."
    same_site = client.post(
        "/auth/register",
        json=registration(email="second@example.com"),
        headers={"Sec-Fetch-Site": "same-site"},
    )
    assert same_site.status_code == 403
    assert client.get("/auth/me", headers=evil).status_code == 200
    assert "access-control-allow-origin" not in client.get("/auth/me", headers=evil).headers


def test_cors_preflight_is_exact_and_exposes_retry_after(client) -> None:
    preflight = client.options(
        "/auth/login",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert preflight.headers["access-control-allow-credentials"] == "true"
    assert preflight.headers["access-control-allow-origin"] != "*"
    actual = client.get("/auth/me", headers={"Origin": "http://localhost:5173"})
    assert actual.headers["access-control-expose-headers"] == "Retry-After"
    assert actual.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert actual.headers["access-control-allow-credentials"] == "true"
    rejected = client.options(
        "/auth/login",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert "access-control-allow-origin" not in rejected.headers


def test_production_cookie_is_secure_and_host_only() -> None:
    settings = Settings(
        _env_file=None,
        app_env="production",
        session_cookie_secure=True,
        database_url="postgresql+psycopg://placeholder:placeholder@localhost/db?sslmode=require",
        session_cookie_name="healthify_session",
        session_ttl_seconds=604800,
    )
    response = Response()
    set_session_cookie(response, "opaque-token", settings)
    header = response.headers["set-cookie"]
    assert header.startswith("healthify_session=opaque-token")
    assert_cookie_attributes(header, secure=True, max_age="604800")


def test_dev_login_cookie_matches_the_contract(client) -> None:
    response = client.post(
        "/auth/register",
        json=registration(),
        headers={"Origin": "http://localhost:5173"},
    )
    header = set_cookie_values(response)[0]
    token = session_token(response)
    assert_cookie_attributes(header, secure=False, max_age="604800")
    assert token not in response.text
