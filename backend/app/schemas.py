"""Request and response models. Validation messages are a fixed catalog."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from email_validator import EmailNotValidError, validate_email
from pydantic import BaseModel, ConfigDict, field_validator


def as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def isoformat_utc(value: datetime) -> str:
    text = as_utc(value).isoformat()
    if text.endswith("+00:00"):
        return text[:-6] + "Z"
    return text


def normalize_email(value: str) -> str:
    stripped = value.strip()
    if len(stripped) > 254:
        raise ValueError("Email must be at most 254 characters.")
    try:
        validated = validate_email(stripped, check_deliverability=False)
    except EmailNotValidError as exc:
        raise ValueError("Enter a valid email address.") from exc
    normalized = validated.normalized.lower()
    if len(normalized) > 254:
        raise ValueError("Email must be at most 254 characters.")
    return normalized


def _require_string(value: Any, *, required: str, type_message: str) -> str:
    if value is None:
        raise ValueError(required)
    if not isinstance(value, str):
        raise ValueError(type_message)
    return value


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    email: str
    password: str

    @field_validator("name", mode="before")
    @classmethod
    def name_type(cls, value: Any) -> Any:
        return _require_string(value, required="Name is required.", type_message="Name must be a string.")

    @field_validator("name")
    @classmethod
    def name_rules(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Name is required.")
        if len(trimmed) > 100:
            raise ValueError("Name must be at most 100 characters.")
        if any(ord(character) < 32 for character in trimmed):
            raise ValueError("Name contains invalid characters.")
        return trimmed

    @field_validator("email", mode="before")
    @classmethod
    def email_type(cls, value: Any) -> Any:
        return _require_string(value, required="Email is required.", type_message="Email must be a string.")

    @field_validator("email")
    @classmethod
    def email_rules(cls, value: str) -> str:
        return normalize_email(value)

    @field_validator("password", mode="before")
    @classmethod
    def password_type(cls, value: Any) -> Any:
        return _require_string(value, required="Password is required.", type_message="Password must be a string.")

    @field_validator("password")
    @classmethod
    def password_rules(cls, value: str) -> str:
        if len(value) < 8:
            raise ValueError("Password must be at least 8 characters.")
        if len(value) > 128:
            raise ValueError("Password must be at most 128 characters.")
        return value


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    email: str
    password: str

    @field_validator("email", mode="before")
    @classmethod
    def email_type(cls, value: Any) -> Any:
        return _require_string(value, required="Email is required.", type_message="Email must be a string.")

    @field_validator("email")
    @classmethod
    def email_rules(cls, value: str) -> str:
        return normalize_email(value)

    @field_validator("password", mode="before")
    @classmethod
    def password_type(cls, value: Any) -> Any:
        return _require_string(value, required="Password is required.", type_message="Password must be a string.")

    @field_validator("password")
    @classmethod
    def password_rules(cls, value: str) -> str:
        if len(value) < 8:
            raise ValueError("Password must be at least 8 characters.")
        if len(value) > 128:
            raise ValueError("Password must be at most 128 characters.")
        return value


class UserPublic(BaseModel):
    id: str
    name: str
    email: str
    created_at: str


class UserEnvelope(BaseModel):
    user: UserPublic


class FieldIssue(BaseModel):
    field: str
    message: str


class ErrorDetails(BaseModel):
    fields: list[FieldIssue]


class ErrorBody(BaseModel):
    code: str
    message: str
    details: ErrorDetails | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody


def serialize_user(user: Any) -> dict[str, str]:
    return {
        "id": str(user.id),
        "name": user.name,
        "email": user.email,
        "created_at": isoformat_utc(user.created_at),
    }


def no_store_headers() -> dict[str, str]:
    return {"Cache-Control": "no-store", "Pragma": "no-cache"}


ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorResponse},
    403: {"model": ErrorResponse},
    409: {"model": ErrorResponse},
    422: {"model": ErrorResponse},
    429: {"model": ErrorResponse},
}
