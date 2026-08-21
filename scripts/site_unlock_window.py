#!/usr/bin/env python3
"""Resolve the repository-configured password-free site window.

The window is half-open: SITE_UNLOCK_START is the first open Playa date and
SITE_UNLOCK_END is the first closed Playa date.  Keeping this logic outside the
workflow makes boundary gating and build-time BURN_OPEN resolution use exactly
the same validation and comparison rules.
"""

from __future__ import annotations

import argparse
from datetime import date


def _parse_window(start_raw: str, end_raw: str) -> tuple[date, date] | None:
    if not start_raw and not end_raw:
        return None
    if not start_raw or not end_raw:
        raise ValueError(
            "SITE_UNLOCK_START and SITE_UNLOCK_END must either both be set or both be unset"
        )
    try:
        start = date.fromisoformat(start_raw)
        end = date.fromisoformat(end_raw)
    except ValueError as exc:
        raise ValueError(
            "SITE_UNLOCK_START and SITE_UNLOCK_END must be valid YYYY-MM-DD dates"
        ) from exc
    if start.isoformat() != start_raw or end.isoformat() != end_raw:
        raise ValueError(
            "SITE_UNLOCK_START and SITE_UNLOCK_END must use canonical YYYY-MM-DD dates"
        )
    if start >= end:
        raise ValueError(
            f"SITE_UNLOCK_START ({start_raw}) must be before SITE_UNLOCK_END ({end_raw})"
        )
    return start, end


def unlock_state(today: date, start_raw: str, end_raw: str) -> str:
    """Return ``open`` or ``closed`` for the half-open configured window."""
    window = _parse_window(start_raw, end_raw)
    if window is None:
        return "closed"
    start, end = window
    return "open" if start <= today < end else "closed"


def boundary_override(today: date, start_raw: str, end_raw: str) -> str:
    """Return a scheduled build override only on an unlock boundary."""
    window = _parse_window(start_raw, end_raw)
    if window is None:
        return ""
    start, end = window
    if today == start:
        return "force-open"
    if today == end:
        return "force-closed"
    return ""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("state", "boundary"))
    parser.add_argument("--today", required=True)
    parser.add_argument("--start", default="")
    parser.add_argument("--end", default="")
    args = parser.parse_args()

    try:
        today = date.fromisoformat(args.today)
        if today.isoformat() != args.today:
            raise ValueError("today must use canonical YYYY-MM-DD form")
        if args.mode == "state":
            print(unlock_state(today, args.start, args.end))
        else:
            print(boundary_override(today, args.start, args.end))
    except ValueError as exc:
        parser.error(str(exc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
