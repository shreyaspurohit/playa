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

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name,
                "description": self.description, "time": self.time}

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Event":
        return cls(
            id=str(d.get("id", "")),
            name=d.get("name", ""),
            description=d.get("description", ""),
            time=d.get("time", ""),
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
