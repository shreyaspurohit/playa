"""Typed dataclasses replacing the dict-shaped camp records.

`to_dict()` keeps the JSON format stable across the page JSONs and the
site payload. `from_dict()` accepts both new and legacy shapes (e.g.,
page JSONs that predate the `website` or `events` fields).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Event:
    id: str
    name: str
    description: str
    time: str
    # Normalized display form ("Tue 8/27 · 10:00 AM – 11:15 AM"). Populated
    # by SiteBuilder post-load; empty string if the raw `time` couldn't be
    # parsed. The template falls back to `time` when this is empty.
    display_time: str = ""
    # Structured parse for the calendar view. Matches the output shape of
    # timeparser.parse_event_time(); None when raw `time` is unparseable.
    #   {kind: "single"|"recurring", days: ["Mon",...], start_day, start_date,
    #    start_time: "HH:MM" 24h, end_day, end_time}
    parsed_time: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "name": self.name,
            "description": self.description, "time": self.time,
            "display_time": self.display_time,
            "parsed_time": self.parsed_time,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Event":
        return cls(
            id=str(d.get("id", "")),
            name=d.get("name", ""),
            description=d.get("description", ""),
            time=d.get("time", ""),
            display_time=d.get("display_time", ""),
            parsed_time=d.get("parsed_time"),
        )


@dataclass
class Camp:
    id: str
    name: str
    location: str
    description: str
    website: str
    url: str
    events: list[Event] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "location": self.location,
            "description": self.description,
            "website": self.website,
            "url": self.url,
            "events": [e.to_dict() for e in self.events],
            "tags": list(self.tags),
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Camp":
        cid = str(d["id"])
        return cls(
            id=cid,
            name=d.get("name", ""),
            location=d.get("location", ""),
            description=d.get("description", ""),
            website=d.get("website", ""),
            url=d.get("url") or f"https://directory.burningman.org/camps/{cid}/",
            events=[Event.from_dict(e) for e in (d.get("events") or [])],
            tags=list(d.get("tags", [])),
        )


@dataclass
class Art:
    """Art installation. Parallel to Camp but with art-specific fields.

    Source-of-truth shapes:
      * Directory `/artwork/<id>/`: id (numeric), name, location string,
        description. No website, no events.
      * API `/api/art?year=YYYY`: SFDC uid, name, artist, hometown,
        category, program, description, location.location_string,
        images[].thumbnail_url. No events.
    Stable across both sources via the union model below — fields the
    other source doesn't populate stay empty (e.g., directory art has
    no `artist`).
    """
    id: str
    name: str
    location: str
    description: str
    url: str
    artist: str = ""
    hometown: str = ""
    category: str = ""
    program: str = ""
    image_url: str = ""    # thumbnail_url from API (first image only)
    year: int = 0          # API only; directory art doesn't carry a year
    tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "location": self.location,
            "description": self.description,
            "url": self.url,
            "artist": self.artist,
            "hometown": self.hometown,
            "category": self.category,
            "program": self.program,
            "image_url": self.image_url,
            "year": self.year,
            "tags": list(self.tags),
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Art":
        aid = str(d["id"])
        return cls(
            id=aid,
            name=d.get("name", ""),
            location=d.get("location", ""),
            description=d.get("description", ""),
            url=d.get("url") or f"https://directory.burningman.org/artwork/{aid}/",
            artist=d.get("artist", "") or "",
            hometown=d.get("hometown", "") or "",
            category=d.get("category", "") or "",
            program=d.get("program", "") or "",
            image_url=d.get("image_url", "") or "",
            year=int(d.get("year") or 0),
            tags=list(d.get("tags", [])),
        )
