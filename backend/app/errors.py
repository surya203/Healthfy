"""API error envelope. Bodies never include passwords, tokens, or hashes."""

from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

VALIDATION_MESSAGES = frozenset(
    {
        "Name is required.",
        "Name must be a string.",
        "Name must be at most 100 characters.",
        "Name contains invalid characters.",
        "Email is required.",
        "Email must be a string.",
        "Enter a valid email address.",
        "Email must be at most 254 characters.",
        "Password is required.",
        "Password must be a string.",
        "Password must be at least 8 characters.",
        "Password must be at most 128 characters.",
        "Request body must be valid JSON.",
        "Invalid value.",
    }
)

_REQUIRED = {
    "name": "Name is required.",
    "email": "Email is required.",
    "password": "Password is required.",
}
_TYPE = {
    "name": "Name must be a string.",
    "email": "Email must be a string.",
    "password": "Password must be a string.",
}
_NON_FIELD_LOCS = {"body", "query", "path", "header", "cookie"}


class APIError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        *,
        details: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details
        self.headers = headers or {}


def error_payload(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        body["details"] = details
    return {"error": body}


def _field_name(loc: tuple[Any, ...]) -> str:
    for part in loc:
        if part in _NON_FIELD_LOCS or isinstance(part, int):
            continue
        return str(part)
    return "body"


def _safe_validator_message(error: dict[str, Any]) -> str | None:
    ctx = error.get("ctx") or {}
    raw = ctx.get("error")
    if isinstance(raw, BaseException) and raw.args:
        text = str(raw.args[0])
        if text in VALIDATION_MESSAGES:
            return text
    if isinstance(raw, str) and raw in VALIDATION_MESSAGES:
        return raw
    message = str(error.get("msg") or "")
    prefix = "Value error, "
    if message.startswith(prefix):
        text = message[len(prefix) :]
        if text in VALIDATION_MESSAGES:
            return text
    return None


def validation_fields(exc: RequestValidationError) -> list[dict[str, str]]:
    fields: list[dict[str, str]] = []
    for error in exc.errors():
        loc = tuple(error.get("loc") or ())
        err_type = str(error.get("type") or "")
        field = _field_name(loc)
        if err_type.startswith("json") or field == "body" or any(isinstance(part, int) for part in loc):
            fields.append({"field": "body", "message": "Request body must be valid JSON."})
            continue
        custom = _safe_validator_message(error)
        if custom is not None:
            fields.append({"field": field, "message": custom})
            continue
        if err_type == "missing":
            fields.append({"field": field, "message": _REQUIRED.get(field, "Invalid value.")})
            continue
        if err_type in {"string_type", "none_required"} or err_type.endswith("_type"):
            fields.append({"field": field, "message": _TYPE.get(field, "Invalid value.")})
            continue
        fields.append({"field": field, "message": "Invalid value."})
    if not fields:
        fields.append({"field": "body", "message": "Request body must be valid JSON."})
    return fields


def register_exception_handlers(app: Any, *, test_mode: bool) -> None:
    @app.exception_handler(APIError)
    async def api_error(_request: Request, exc: APIError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload(exc.code, exc.message, exc.details),
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=error_payload(
                "VALIDATION_ERROR",
                "Invalid input.",
                {"fields": validation_fields(exc)},
            ),
        )

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, exc: HTTPException) -> JSONResponse:
        codes = {
            404: ("NOT_FOUND", "Not found."),
            405: ("METHOD_NOT_ALLOWED", "Method not allowed."),
        }
        code, message = codes.get(exc.status_code, ("HTTP_ERROR", "Request failed."))
        return JSONResponse(status_code=exc.status_code, content=error_payload(code, message))

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> JSONResponse:
        import logging

        logger = logging.getLogger("healthify")
        if test_mode:
            logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        else:
            logger.error(
                "Unhandled error on %s %s (%s)",
                request.method,
                request.url.path,
                type(exc).__name__,
            )
        return JSONResponse(
            status_code=500,
            content=error_payload("INTERNAL_ERROR", "Internal server error."),
        )
