"""Parse event time strings from directory.burningman.org into structured
form + a clean display string.

Raw strings come in two main shapes (empirically, ~99% of 4167 events):

  1. "Begins Tue (8/27) at 10:00 AM, Ends 11:15 AM"        single-occurrence
  2. "Begins Thu (8/29) at 9:00 PM, Ends Fri at 2:00 AM"   spans midnight
  3. "From 11:00 AM to 3:00 PM on Mon, Tue, Wed, Thu, Fri" recurring

We normalize to:

  {
    "kind":        "single" | "recurring",
    "days":        ["Tue"]  |  ["Mon", "Tue", "Wed", ...]
    "start_day":   "Tue"   |  None,
    "start_date":  "8/27"  |  None,           # only from "Begins" form
    "start_time":  "10:00",                    # 24-hour HH:MM
    "end_day":     "Tue"   |  None,
    "end_time":    "11:15",
  }

...and a compact display string:

  Tue 8/27 · 10:00 AM – 11:15 AM
  Thu 8/29 9:00 PM – Fri 8/30 2:00 AM
  Mon–Fri · 11:00 AM – 3:00 PM (starts 8/26)

We explicitly do NOT hardcode a year. Instead, `derive_week_map()` walks all
single-occurrence events in a given scrape and builds {day: "M/D"} from
what the directory posted this year. Recurring events pick up "(starts M/D)"
by looking up their earliest day in that map. When the directory updates
for a new burn year, the map self-adjusts.
"""
from __future__ import annotations

import re
from collections import Counter
from typing import Optional


WEEK_ORDER = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
_DAY_INDEX = {d.lower(): i for i, d in enumerate(WEEK_ORDER)}


_BEGINS_RE = re.compile(
    r"^Begins\s+(?P<sday>[A-Za-z]{3})\s+\((?P<smonth>\d+)/(?P<sdate>\d+)\)\s+"
    r"at\s+(?P<stime>\d{1,2}:\d{2})\s+(?P<sampm>AM|PM),?\s+"
    r"Ends\s+(?:(?P<eday>[A-Za-z]{3})\s+at\s+)?(?P<etime>\d{1,2}:\d{2})\s+(?P<eampm>AM|PM)\.?\s*$",
    re.IGNORECASE,
)

_FROM_RE = re.compile(
    r"^From\s+(?P<stime>\d{1,2}:\d{2})\s+(?P<sampm>AM|PM)\s+"
    r"to\s+(?P<etime>\d{1,2}:\d{2})\s+(?P<eampm>AM|PM)\s+"
    r"on\s+(?P<days>[A-Za-z0-9,\s]+?)\.?\s*$",
    re.IGNORECASE,
)

_DAY_SUFFIX_RE = re.compile(r"\d+$")


def _normalize_day(token: str) -> Optional[str]:
    """'Mon' -> 'Mon'. 'Sun2' -> 'Sun' (the directory's suffix for the
    closing Sunday). Unknown tokens return None."""
    s = _DAY_SUFFIX_RE.sub("", token.strip()).title()
    return s if s.lower() in _DAY_INDEX else None


def _to_24h(hm: str, ampm: str) -> str:
    """'10:00', 'AM' -> '10:00' (24h). '12:00', 'AM' -> '00:00'. '12:00', 'PM' -> '12:00'."""
    h_str, m_str = hm.split(":")
    h = int(h_str)
    a = ampm.upper()
    if a == "AM":
        if h == 12:
            h = 0
    else:  # PM
        if h != 12:
            h += 12
    return f"{h:02d}:{m_str}"


def _to_12h(hm24: str) -> str:
    """'00:00' -> '12:00 AM'. '13:30' -> '1:30 PM'."""
    h_str, m_str = hm24.split(":")
    h = int(h_str)
    if h == 0:
        return f"12:{m_str} AM"
    if h < 12:
        return f"{h}:{m_str} AM"
    if h == 12:
        return f"12:{m_str} PM"
    return f"{h - 12}:{m_str} PM"


def parse_event_time(raw: str) -> Optional[dict]:
    """Return a structured parse, or None if the format isn't recognized."""
    if not raw:
        return None
    s = raw.strip()

    m = _BEGINS_RE.match(s)
    if m:
        sday = m.group("sday").title()
        if sday.lower() not in _DAY_INDEX:
            return None
        eday_raw = m.group("eday")
        eday = eday_raw.title() if eday_raw else sday
        if eday.lower() not in _DAY_INDEX:
            eday = sday
        return {
            "kind": "single",
            "days": [sday],
            "start_day":  sday,
            "start_date": f"{int(m.group('smonth'))}/{int(m.group('sdate'))}",
            "start_time": _to_24h(m.group("stime"), m.group("sampm")),
            "end_day":    eday,
            "end_time":   _to_24h(m.group("etime"), m.group("eampm")),
        }

    m = _FROM_RE.match(s)
    if m:
        days_raw = m.group("days").strip().rstrip(".")
        parts = [p for p in re.split(r",\s*", days_raw) if p.strip()]
        # Dedupe while preserving order: "Mon, Tue, ..., Mon2" collapses to
        # one "Mon" entry (we lose the second-week distinction, which is
        # fine for the current display; calendar view can track it later).
        seen = set()
        days: list[str] = []
        for p in parts:
            norm = _normalize_day(p)
            if norm and norm not in seen:
                seen.add(norm)
                days.append(norm)
        if not days:
            return None
        return {
            "kind": "recurring",
            "days": days,
            "start_day":  None,
            "start_date": None,
            "start_time": _to_24h(m.group("stime"), m.group("sampm")),
            "end_day":    None,
            "end_time":   _to_24h(m.group("etime"), m.group("eampm")),
        }

    return None


def derive_week_map(parsed_events) -> dict[str, str]:
    """{day_abbrev: 'M/D'} from every single-occurrence event's start date.

    If a day surfaces with multiple dates (e.g., both opening-Sunday and
    closing-Sunday of burn week), we pick the most frequent one — in
    practice, most events cluster in the core Mon–Sat window so this
    favors the primary occurrence.
    """
    counts: dict[str, Counter] = {}
    for p in parsed_events:
        if p and p["kind"] == "single" and p["start_date"]:
            counts.setdefault(p["start_day"], Counter())[p["start_date"]] += 1
    return {day: c.most_common(1)[0][0] for day, c in counts.items() if c}


def _compact_days(days) -> str:
    """
    [Mon,Tue,Wed,Thu,Fri]            -> Mon–Fri    (contiguous run)
    [Mon,Tue,Wed,Thu,Fri,Sat,Sun]    -> Daily
    [Tue,Thu]                        -> Tue, Thu   (non-contiguous)
    [Mon]                            -> Mon
    """
    if not days:
        return ""
    indices = sorted({_DAY_INDEX[d.lower()] for d in days})
    if len(indices) == 7:
        return "Daily"
    if len(indices) >= 3 and indices == list(range(indices[0], indices[-1] + 1)):
        return f"{WEEK_ORDER[indices[0]]}–{WEEK_ORDER[indices[-1]]}"
    return ", ".join(WEEK_ORDER[i] for i in indices)


def format_display(parsed: Optional[dict], week_map: dict[str, str]) -> Optional[str]:
    """Clean string for the event card. None if `parsed` is None (caller
    should fall back to the raw string)."""
    if not parsed:
        return None
    st = _to_12h(parsed["start_time"])
    et = _to_12h(parsed["end_time"])

    if parsed["kind"] == "single":
        sday = parsed["start_day"]
        sdate = parsed["start_date"]
        eday = parsed["end_day"]
        if eday == sday:
            return f"{sday} {sdate} · {st} – {et}"
        edate = week_map.get(eday)
        if edate:
            return f"{sday} {sdate} {st} – {eday} {edate} {et}"
        return f"{sday} {sdate} {st} – {eday} {et}"

    if parsed["kind"] == "recurring":
        day_str = _compact_days(parsed["days"])
        # Earliest day, by week order — serves as "starts" annotation.
        earliest = min(parsed["days"], key=lambda d: _DAY_INDEX[d.lower()])
        earliest_date = week_map.get(earliest)
        if earliest_date:
            return f"{day_str} · {st} – {et} (starts {earliest_date})"
        return f"{day_str} · {st} – {et}"

    return None


def annotate_events(events_raw_times) -> list[str]:
    """Convenience: given an iterable of raw time strings, return a list of
    display strings (one per input). Used by SiteBuilder to enrich events.

    Two-pass: (1) parse everything to build the week_map, (2) format each
    using the derived map. The structured parses are dropped here — the
    calendar view can call `parse_event_time()` directly when it needs them.
    """
    parsed = [parse_event_time(t) for t in events_raw_times]
    week_map = derive_week_map(parsed)
    return [format_display(p, week_map) or "" for p in parsed]
