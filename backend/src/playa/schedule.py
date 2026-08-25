"""Official annual event windows and normalized occurrence formatting."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional


# Add a year only after verifying it against an official Burning Man page.
# 2025: https://history.burningman.org/timeline/2025/
# 2026: https://burningman.org/event/black
ANNUAL_EVENT_WINDOWS: dict[int, tuple[str, str]] = {
    2025: ("2025-08-24", "2025-09-01"),
    2026: ("2026-08-30", "2026-09-07"),
}

WEEK_ORDER = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
_DAY_INDEX = {day.lower(): index for index, day in enumerate(WEEK_ORDER)}


def event_window_for_year(year: int) -> tuple[str, str]:
    """Return a reviewed official window; never infer an unknown year."""
    try:
        first_iso, last_iso = ANNUAL_EVENT_WINDOWS[year]
    except KeyError as error:
        raise ValueError(
            f"no reviewed official event window for api-{year}; verify the "
            "dates with Burning Man Project and add them to ANNUAL_EVENT_WINDOWS"
        ) from error
    try:
        first = date.fromisoformat(first_iso)
        last = date.fromisoformat(last_iso)
    except ValueError as error:
        raise ValueError(f"invalid reviewed event window for api-{year}") from error
    if first.year != year or last.year != year or first > last:
        raise ValueError(
            f"reviewed event window for api-{year} must stay inside that year"
        )
    return first_iso, last_iso


def _to_12h(hm24: str) -> str:
    """Convert a normalized 24-hour ``HH:MM`` value for display."""
    h_str, m_str = hm24.split(":")
    hour = int(h_str)
    if hour == 0:
        return f"12:{m_str} AM"
    if hour < 12:
        return f"{hour}:{m_str} AM"
    if hour == 12:
        return f"12:{m_str} PM"
    return f"{hour - 12}:{m_str} PM"


def _compact_days(days) -> str:
    """Compact weekday labels for a recurring event's display string."""
    if not days:
        return ""
    indices = sorted({_DAY_INDEX[day.lower()] for day in days})
    if len(indices) == 7:
        return "Daily"
    if len(indices) >= 3 and indices == list(range(indices[0], indices[-1] + 1)):
        return f"{WEEK_ORDER[indices[0]]}–{WEEK_ORDER[indices[-1]]}"
    return ", ".join(WEEK_ORDER[index] for index in indices)


def date_in_year(iso: str, year: int) -> bool:
    """True only for a real ISO date belonging to the annual API source."""
    try:
        return date.fromisoformat(iso).year == year
    except (AttributeError, TypeError, ValueError):
        return False


def date_in_window(iso: str, window_start: str, window_end: str) -> bool:
    """True when an ISO occurrence date is inside one same-year window."""
    try:
        first = date.fromisoformat(window_start)
        last = date.fromisoformat(window_end)
        candidate = date.fromisoformat(iso)
        return (
            first.year == last.year == candidate.year
            and first <= candidate <= last
        )
    except (AttributeError, TypeError, ValueError):
        return False


def format_schedule_display(parsed: Optional[dict]) -> Optional[str]:
    """Render a card label from exact normalized occurrence dates."""
    if not parsed:
        return None
    dates = parsed.get("dates") or []
    if not dates:
        return None
    start_time = _to_12h(parsed["start_time"])
    end_time = _to_12h(parsed["end_time"])

    def parsed_date(iso: str) -> date:
        return date.fromisoformat(iso)

    def weekday(iso: str) -> str:
        return WEEK_ORDER[parsed_date(iso).weekday()]

    def month_day(iso: str) -> str:
        value = parsed_date(iso)
        return f"{value.month}/{value.day}"

    if len(dates) == 1:
        iso = dates[0]
        if parsed.get("overnight"):
            next_day = parsed_date(iso) + timedelta(days=1)
            return (
                f"{weekday(iso)} {month_day(iso)} {start_time} – "
                f"{WEEK_ORDER[next_day.weekday()]} "
                f"{next_day.month}/{next_day.day} {end_time}"
            )
        return f"{weekday(iso)} {month_day(iso)} · {start_time} – {end_time}"

    occurrence_dates = sorted({parsed_date(iso) for iso in dates})
    day_abbrevs: list[str] = []
    seen: set[str] = set()
    for occurrence_date in occurrence_dates:
        day = WEEK_ORDER[occurrence_date.weekday()]
        if day not in seen:
            seen.add(day)
            day_abbrevs.append(day)

    first = occurrence_dates[0]
    last = occurrence_dates[-1]
    first_label = f"{first.month}/{first.day}"
    last_label = f"{last.month}/{last.day}"
    consecutive = all(
        right - left == timedelta(days=1)
        for left, right in zip(occurrence_dates, occurrence_dates[1:])
    )

    # A weekday-only label such as "Daily" or "Sun" hides the recurrence's
    # actual bounds. Keep compact weekday language, but always include the
    # first/last exact occurrence dates so Camp/Food/Map cards cannot imply an
    # event continues beyond its API occurrence_set.
    if len(day_abbrevs) == 1:
        date_labels = [f"{value.month}/{value.day}" for value in occurrence_dates]
        recurrence_label = f"{day_abbrevs[0]} " + " & ".join(date_labels)
    else:
        compact_days = _compact_days(day_abbrevs)
        if compact_days == "Daily" and not consecutive:
            compact_days = f"{len(occurrence_dates)} dates"
        recurrence_label = f"{compact_days} {first_label}–{last_label}"

    overnight_suffix = " +1" if parsed.get("overnight") else ""
    return (
        f"{recurrence_label} · {start_time} – {end_time}"
        f"{overnight_suffix}"
    )
