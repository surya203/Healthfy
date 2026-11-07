"""Login limit through a real uvicorn process.

Starlette's TestClient never installs uvicorn's ProxyHeadersMiddleware, which
is what rewrites the peer from X-Forwarded-For for loopback clients.
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

import httpx
import uvicorn
from sqlalchemy import func, select
from tests.helpers import reload
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.config import get_settings
from app.models import LoginFailure
from app.server import uvicorn_config

_LOGIN = {"email": "ada@example.com", "password": "correct-horse"}
_REGISTER = {"name": "Ada Lovelace", "email": "ada@example.com", "password": "correct-horse"}


def test_supported_uvicorn_config_disables_proxy_headers() -> None:
    config = uvicorn_config()
    assert config["proxy_headers"] is False
    assert config["forwarded_allow_ips"] == ""
    loaded = uvicorn.Config(
        config["app"],
        host="127.0.0.1",
        port=8000,
        proxy_headers=False,
        forwarded_allow_ips="",
    )
    loaded.load()
    assert not isinstance(loaded.loaded_app, ProxyHeadersMiddleware)


def test_real_uvicorn_ignores_forwarded_for_unless_trusted(db, seed_login_failures) -> None:
    with _server("false") as base:
        created = httpx.post(f"{base}/auth/register", json=_REGISTER, timeout=10)
        assert created.status_code == 201
        seed_login_failures("127.0.0.1", datetime.now(UTC), count=5)
        for headers in (None, {"X-Forwarded-For": "203.0.113.9"}, {"X-Forwarded-For": "203.0.113.9, 198.51.100.20"}):
            response = httpx.post(f"{base}/auth/login", json=_LOGIN, headers=headers, timeout=10)
            assert response.status_code == 429, headers
            assert response.json()["error"]["code"] == "RATE_LIMITED"
            assert "correct-horse" not in response.text
            assert "203.0.113.9" not in response.text
        reload(db)
        assert set(db.scalars(select(LoginFailure.client_ip))) == {"127.0.0.1"}

    with _server("true") as base:
        blocked = httpx.post(f"{base}/auth/login", json=_LOGIN, timeout=10)
        assert blocked.status_code == 429
        single = httpx.post(
            f"{base}/auth/login",
            json=_LOGIN,
            headers={"X-Forwarded-For": "203.0.113.50"},
            timeout=10,
        )
        assert single.status_code == 200
        multiple = httpx.post(
            f"{base}/auth/login",
            json={"email": "ada@example.com", "password": "wrong-password"},
            headers={"X-Forwarded-For": "203.0.113.50, 198.51.100.77"},
            timeout=10,
        )
        assert multiple.status_code == 401
        assert multiple.json()["error"]["code"] == "INVALID_CREDENTIALS"
        reload(db)
        counts = dict(
            db.execute(
                select(LoginFailure.client_ip, func.count())
                .group_by(LoginFailure.client_ip)
                .order_by(LoginFailure.client_ip)
            ).all()
        )
        assert counts["127.0.0.1"] == 5
        assert counts["198.51.100.77"] == 1
        assert "203.0.113.50" not in counts
        assert "203.0.113.9" not in counts


@contextmanager
def _server(trust_forwarded: str) -> Iterator[str]:
    port = _free_port()
    env = os.environ.copy()
    env.update(
        {
            "HOST": "127.0.0.1",
            "PORT": str(port),
            "APP_ENV": "test",
            "TRUST_X_FORWARDED_FOR": trust_forwarded,
            "UVICORN_RELOAD": "",
            "DATABASE_URL": get_settings().database_url,
            # Dangerous uvicorn default. The supported launcher must ignore it.
            "FORWARDED_ALLOW_IPS": "127.0.0.1,::1",
            "PYTHONUNBUFFERED": "1",
        }
    )
    backend_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    process = subprocess.Popen(
        [sys.executable, "-m", "app.server"],
        cwd=backend_root,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    base = f"http://127.0.0.1:{port}"
    try:
        _wait_until_up(process, f"{base}/health")
        yield base
    except Exception:
        _stop(process, dump=True)
        raise
    else:
        _stop(process, dump=False)


def _stop(process: subprocess.Popen[str], *, dump: bool) -> None:
    if process.poll() is None:
        process.terminate()
    try:
        output, _ = process.communicate(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        output, _ = process.communicate(timeout=5)
    if dump or process.returncode not in {0, -15, None}:
        print(output)


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_until_up(process: subprocess.Popen[str], url: str) -> None:
    deadline = time.time() + 20
    last_error = ""
    while time.time() < deadline:
        if process.poll() is not None:
            output, _ = process.communicate(timeout=5)
            raise RuntimeError(f"uvicorn exited early:\n{output}")
        try:
            response = httpx.get(url, timeout=0.5)
            if response.status_code == 200:
                return
        except httpx.HTTPError as exc:
            last_error = str(exc)
        time.sleep(0.1)
    process.terminate()
    output, _ = process.communicate(timeout=5)
    raise RuntimeError(f"uvicorn did not start ({last_error}):\n{output}")
