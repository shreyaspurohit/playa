"""Typed records shared by the API adapter and site builder."""
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
    # Structured API occurrence data for Schedule/Food; None when no valid
    # occurrence is available. Full ISO dates preserve annual source identity.
    #   {kind: "single"|"recurring", dates: ["YYYY-MM-DD", ...],
    #    days: ["Mon",...], start_time: "HH:MM", end_time: "HH:MM",
    #    overnight: bool}
    parsed_time: dict[str, Any] | None = None
    # App-generated food-type classifications for this event (e.g.
    # ["tacos", "vegan"]). Populated by Tagger.tag_event_food at
    # build time; empty for non-food events. Omitted from to_dict when empty.
    food_tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        d = {
            "id": self.id, "name": self.name,
            "description": self.description, "time": self.time,
            "display_time": self.display_time,
            "parsed_time": self.parsed_time,
        }
        if self.food_tags:
            d["food_tags"] = list(self.food_tags)
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Event":
        return cls(
            id=str(d.get("id", "")),
            name=d.get("name", ""),
            description=d.get("description", ""),
            time=d.get("time", ""),
            display_time=d.get("display_time", ""),
            parsed_time=d.get("parsed_time"),
            food_tags=list(d.get("food_tags", [])),
        )


@dataclass
class Camp:
    id: str
    name: str
    location: str
    description: str
    website: str
    events: list[Event] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    # Food-type buckets the camp advertises in its own name+description (ADR
    # docs/17). Drives the Food tab's camp-level "anytime" rows precisely,
    # unlike the coarse `food` tag. Omitted from to_dict when empty.
    food_tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        d = {
            "id": self.id,
            "name": self.name,
            "location": self.location,
            "description": self.description,
            "website": self.website,
            "events": [e.to_dict() for e in self.events],
            "tags": list(self.tags),
        }
        if self.food_tags:
            d["food_tags"] = list(self.food_tags)
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Camp":
        cid = str(d["id"])
        return cls(
            id=cid,
            name=d.get("name", ""),
            location=d.get("location", ""),
            description=d.get("description", ""),
            website=d.get("website", ""),
            events=[Event.from_dict(e) for e in (d.get("events") or [])],
            tags=list(d.get("tags", [])),
            food_tags=list(d.get("food_tags", [])),
        )


@dataclass
class Art:
    """Art installation normalized from an annual API snapshot."""
    id: str
    name: str
    location: str
    description: str
    artist: str = ""
    hometown: str = ""
    category: str = ""
    program: str = ""
    image_url: str = ""    # thumbnail_url from API (first image only)
    year: int = 0
    tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "location": self.location,
            "description": self.description,
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
            artist=d.get("artist", "") or "",
            hometown=d.get("hometown", "") or "",
            category=d.get("category", "") or "",
            program=d.get("program", "") or "",
            image_url=d.get("image_url", "") or "",
            year=int(d.get("year") or 0),
            tags=list(d.get("tags", [])),
        )
