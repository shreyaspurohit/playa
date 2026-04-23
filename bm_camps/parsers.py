"""Regex parsers for the directory.burningman.org HTML.

Two parsers, both pure (no state, no I/O) — classes just namespace the
regexes next to the parse() method so they're easy to find and tweak.
"""
from __future__ import annotations

import html as _html
import re
from typing import Iterator

from .models import Event


def _clean(text: str) -> str:
    """Strip tags, decode HTML entities, collapse whitespace."""
    text = re.sub(r"<[^>]+>", "", text)
    text = _html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


class ListingParser:
    """Parses /camps/?page=N — a list of camp rows."""

    ENTRY_RE = re.compile(
        r'<a class="list-group-item" href="/camps/(\d+)/">\s*'
        r'<div class="row">\s*'
        r'<div class="col-sm-3">\s*(.*?)\s*</div>\s*'
        r'<div class="col-sm-2">\s*(.*?)\s*</div>\s*'
        r'<div class="col-sm-7">\s*(.*?)\s*</div>\s*'
        r'</div>\s*</a>',
        re.DOTALL,
    )

    @classmethod
    def parse(cls, html: str) -> Iterator[tuple[str, str, str, str]]:
        """Yield (camp_id, name, location, short_description) per entry."""
        for m in cls.ENTRY_RE.finditer(html):
            yield (
                m.group(1),
                _clean(m.group(2)),
                _clean(m.group(3)),
                _clean(m.group(4)),
            )


class DetailParser:
    """Parses /camps/{id}/ — camp name, location, website, description, events."""

    NAME_RE = re.compile(r"<h1>Camp:\s*(.*?)</h1>", re.DOTALL)
    LOC_RE = re.compile(r"Location:\s*<tt>(.*?)</tt>", re.DOTALL)
    WEBSITE_RE = re.compile(r"Website:\s*<tt>(.*?)</tt>", re.DOTALL)
    DESC_RE = re.compile(
        r"<h2>Description:\s*</h2>\s*<p>(.*?)</p>",
        re.DOTALL,
    )
    # Events block: between "<h2>Camp Events</h2>" and either the next
    # "<h2>" (typically "Message <camp name>") or the page's outer </div>
    # ladder. This bounds the EVENT_ENTRY_RE search so we never pick up
    # list-group-items from unrelated sections.
    EVENTS_BLOCK_RE = re.compile(
        r"<h2>Camp Events</h2>(.*?)(?:<h2>|</div>\s*</div>\s*</div>)",
        re.DOTALL,
    )
    EVENT_ENTRY_RE = re.compile(
        r'<a class="list-group-item" href="/events/(\d+)/">\s*'
        r'<div class="row">\s*'
        r'<div class="col-sm-3">\s*(.*?)\s*</div>\s*'
        r'<div class="col-sm-6">\s*(.*?)\s*</div>\s*'
        r'<div class="col-sm-3">\s*(.*?)\s*</div>\s*'
        r'</div>\s*</a>',
        re.DOTALL,
    )

    @classmethod
    def parse(cls, html: str) -> tuple[str, str, str, str, list[Event]]:
        """Return (name, location, website, description, events)."""
        name_m = cls.NAME_RE.search(html)
        name = _clean(name_m.group(1)) if name_m else ""

        loc_m = cls.LOC_RE.search(html)
        location = _clean(loc_m.group(1)) if loc_m else ""

        web_m = cls.WEBSITE_RE.search(html)
        website = _clean(web_m.group(1)) if web_m else ""

        desc_m = cls.DESC_RE.search(html)
        description = _clean(desc_m.group(1)) if desc_m else ""

        events: list[Event] = []
        block_m = cls.EVENTS_BLOCK_RE.search(html)
        if block_m:
            for em in cls.EVENT_ENTRY_RE.finditer(block_m.group(1)):
                events.append(Event(
                    id=em.group(1),
                    name=_clean(em.group(2)),
                    description=_clean(em.group(3)),
                    time=_clean(em.group(4)),
                ))
        return name, location, website, description, events
