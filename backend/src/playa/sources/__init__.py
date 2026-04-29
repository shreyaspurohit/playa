"""Pluggable data sources for camp + event listings.

Each source implements `name` (string id used in DOM/LS keys) and
`load_camps(config) -> list[Camp]`. The builder enumerates whichever
sources the user asked for and emits one encrypted payload per source.

See docs/15-data-sources.md for the architecture rationale.
"""
from __future__ import annotations

from typing import Protocol

from ..config import Config
from ..models import Camp


class Source(Protocol):
    name: str

    def load_camps(self, config: Config) -> list[Camp]: ...


def make_source(spec: str) -> Source:
    """Resolve a source spec string to a concrete Source instance.

    Recognized specs:
      * "directory"   — directory.burningman.org HTML scrape
      * "api-YYYY"    — api.burningman.org bulk endpoints, year=YYYY

    Unknown specs raise ValueError so a typo in --sources doesn't
    silently produce an empty payload.
    """
    if spec == "directory":
        from .directory import DirectorySource
        return DirectorySource()
    if spec.startswith("api-"):
        try:
            year = int(spec[len("api-"):])
        except ValueError as e:
            raise ValueError(f"bad api source spec {spec!r}: {e}") from e
        from .api import APISource
        return APISource(year=year)
    raise ValueError(f"unknown source: {spec!r}")
