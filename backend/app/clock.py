"""Process clock. Tests may replace it in-process. There is no HTTP control for it."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Protocol


class SupportsNow(Protocol):
    def now(self) -> datetime: ...


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)


_current: SupportsNow = SystemClock()


def now() -> datetime:
    return _current.now()


def configure(clock: SupportsNow) -> None:
    global _current
    if not hasattr(clock, "now"):
        raise TypeError("clock must provide now()")
    _current = clock


def reset() -> None:
    configure(SystemClock())
