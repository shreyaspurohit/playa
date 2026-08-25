"""Annual API-snapshot source registry."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from ..config import Config
from ..models import Art, Camp


@dataclass
class SourceSnapshot:
    """One decrypted cache read, normalized for the builder."""

    camps: list[Camp]
    art: list[Art]
    fetched_at: str


class Source(Protocol):
    name: str
    year: int

    def load_snapshot(self, config: Config) -> SourceSnapshot: ...


def make_source(spec: str) -> Source:
    """Resolve a source spec string to a concrete Source instance.

    Only ``api-YYYY`` is valid. Unknown or malformed specs fail closed.
    """
    if spec.startswith("api-") and len(spec) == 8 and spec[4:].isdigit():
        year = int(spec[4:])
        from .api import APISource
        return APISource(year=year)
    raise ValueError(f"unknown source: {spec!r}")
