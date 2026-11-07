from starlette.requests import Request

from app.client_ip import client_ip


def _request(headers: dict[str, str], host: str | None) -> Request:
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/auth/login",
        "raw_path": b"/auth/login",
        "query_string": b"",
        "headers": [(key.lower().encode(), value.encode()) for key, value in headers.items()],
        "client": None if host is None else (host, 1234),
        "server": ("localhost", 8000),
    }
    return Request(scope)


def test_client_ip_ignores_forwarded_header_by_default() -> None:
    request = _request({"X-Forwarded-For": "198.51.100.9"}, "203.0.113.4")
    assert client_ip(request, trust_x_forwarded_for=False) == "203.0.113.4"


def test_client_ip_uses_rightmost_hop_only_when_trusted() -> None:
    request = _request({"X-Forwarded-For": "198.51.100.9, 192.0.2.15"}, "10.0.0.8")
    assert client_ip(request, trust_x_forwarded_for=True) == "192.0.2.15"
    assert client_ip(_request({}, None), trust_x_forwarded_for=False) == "unknown"
