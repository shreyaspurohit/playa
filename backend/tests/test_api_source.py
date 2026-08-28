"""Unit tests for playa.sources.api — schema mapping + cache loading.

The HTTP path is mocked separately; cache-loading tests use hand-crafted API
snapshots at the production cache path.
"""
import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from playa.config import Config
from playa.sources.api import APISource


def _silent(fn, *args, **kwargs):
    with contextlib.redirect_stdout(io.StringIO()):
        return fn(*args, **kwargs)


def _load_camps(source, config):
    return source.load_snapshot(config).camps


class APISourceLoadTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.config = Config(root=self.root, brc_map_year=2026)
        self.config.api_dir.mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def _write(self, year, payload):
        payload.setdefault("fetched_at", "2026-08-15T12:34:56Z")
        payload.setdefault("art", [])
        self.config.api_payload_file(year).write_text(json.dumps(payload))

    def test_missing_cache_raises_with_helpful_message(self):
        src = APISource(year=2024)
        with self.assertRaises(FileNotFoundError) as cm:
            src.load_snapshot(self.config)
        self.assertIn("api-fetch", str(cm.exception))

    def test_basic_camp_mapping_uid_to_id(self):
        self._write(2024, {
            "year": 2024,
            "camps": [
                {
                    "uid": "a1XVI000001vN7N2AU",
                    "name": "Census",
                    "year": 2024,
                    "url": "http://census.burningman.org",
                    "description": "We count things.",
                    "location_string": "Esplanade & 6:30",
                },
            ],
            "events": [],
        })
        camps = _silent(_load_camps, APISource(year=2024), self.config)
        self.assertEqual(len(camps), 1)
        c = camps[0]
        self.assertEqual(c.id, "a1XVI000001vN7N2AU")
        self.assertEqual(c.name, "Census")
        self.assertEqual(c.location, "Esplanade & 6:30")
        self.assertEqual(c.description, "We count things.")
        self.assertEqual(c.website, "http://census.burningman.org")
        self.assertNotIn("url", c.to_dict())

    def test_snapshot_returns_art_and_fetched_at(self):
        self._write(2024, {
            "fetched_at": "2024-08-20T01:02:03Z",
            "camps": [], "events": [],
            "art": [{"uid": "art-1", "name": "Glow", "location_string": "The Man"}],
        })
        snapshot = APISource(year=2024).load_snapshot(self.config)
        self.assertEqual(snapshot.fetched_at, "2024-08-20T01:02:03Z")
        self.assertEqual([piece.id for piece in snapshot.art], ["art-1"])

    def test_cache_without_fetched_at_is_rejected(self):
        self.config.api_payload_file(2024).write_text(
            json.dumps({"camps": [], "events": [], "art": []}),
        )
        with self.assertRaisesRegex(RuntimeError, "fetched_at"):
            APISource(year=2024).load_snapshot(self.config)

    def test_camp_without_uid_is_dropped(self):
        self._write(2024, {
            "camps": [
                {"name": "no-uid", "year": 2024, "location_string": ""},
                {"uid": "valid", "name": "ok", "year": 2024, "location_string": ""},
            ],
            "events": [],
        })
        camps = _silent(_load_camps, APISource(year=2024), self.config)
        self.assertEqual([c.id for c in camps], ["valid"])

    def test_events_attach_to_their_host_camp(self):
        self._write(2024, {
            "camps": [
                {"uid": "campA", "name": "A", "year": 2024, "location_string": "6:00 & E"},
                {"uid": "campB", "name": "B", "year": 2024, "location_string": "7:00 & F"},
            ],
            "events": [
                {
                    "uid": "evA1", "title": "A workshop", "year": 2024,
                    "hosted_by_camp": "campA",
                    "occurrence_set": [
                        {"start_time": "2024-08-27T10:00:00-07:00",
                         "end_time":   "2024-08-27T11:00:00-07:00"},
                    ],
                },
                {
                    "uid": "evB1", "title": "B party", "year": 2024,
                    "hosted_by_camp": "campB",
                    "occurrence_set": [
                        {"start_time": "2024-08-29T20:00:00-07:00",
                         "end_time":   "2024-08-29T22:00:00-07:00"},
                    ],
                },
            ],
        })
        camps = _silent(_load_camps, APISource(year=2024), self.config)
        a = next(c for c in camps if c.id == "campA")
        b = next(c for c in camps if c.id == "campB")
        self.assertEqual([e.id for e in a.events], ["evA1"])
        self.assertEqual([e.id for e in b.events], ["evB1"])

    def test_identical_event_rows_are_attached_once(self):
        event = {
            "uid": "evA1", "title": "A workshop", "year": 2024,
            "hosted_by_camp": "campA",
            "occurrence_set": [
                {"start_time": "2024-08-27T10:00:00-07:00",
                 "end_time":   "2024-08-27T11:00:00-07:00"},
            ],
        }
        self._write(2024, {
            "camps": [
                {"uid": "campA", "name": "A", "year": 2024,
                 "location_string": "6:00 & E"},
            ],
            "events": [event, dict(event)],
        })

        camps = _silent(_load_camps, APISource(year=2024), self.config)

        self.assertEqual([e.id for e in camps[0].events], ["evA1"])

    def test_conflicting_event_rows_with_same_uid_are_rejected(self):
        event = {
            "uid": "evA1", "title": "A workshop", "year": 2024,
            "hosted_by_camp": "campA",
            "occurrence_set": [
                {"start_time": "2024-08-27T10:00:00-07:00",
                 "end_time":   "2024-08-27T11:00:00-07:00"},
            ],
        }
        changed_event = dict(event, title="A different workshop")
        self._write(2024, {
            "camps": [
                {"uid": "campA", "name": "A", "year": 2024,
                 "location_string": "6:00 & E"},
            ],
            "events": [event, changed_event],
        })

        with self.assertRaisesRegex(RuntimeError, "conflicting event records"):
            APISource(year=2024).load_snapshot(self.config)

    def test_events_with_no_host_are_dropped(self):
        self._write(2024, {
            "camps": [
                {"uid": "campA", "name": "A", "year": 2024, "location_string": ""},
            ],
            "events": [
                {"uid": "orphan", "title": "no host", "year": 2024,
                 "hosted_by_camp": None, "occurrence_set": []},
            ],
        })
        camps = _silent(_load_camps, APISource(year=2024), self.config)
        self.assertEqual(camps[0].events, [])

    def test_recurring_event_coalesces_to_one(self):
        # Same time-of-day, three different days → one Event with
        # kind=recurring + days list.
        self._write(2024, {
            "camps": [{"uid": "c", "name": "C", "year": 2024, "location_string": ""}],
            "events": [{
                "uid": "ev",
                "title": "Daily",
                "year": 2024,
                "hosted_by_camp": "c",
                "occurrence_set": [
                    {"start_time": "2024-08-27T13:00:00-07:00",
                     "end_time":   "2024-08-27T14:30:00-07:00"},
                    {"start_time": "2024-08-28T13:00:00-07:00",
                     "end_time":   "2024-08-28T14:30:00-07:00"},
                    {"start_time": "2024-08-29T13:00:00-07:00",
                     "end_time":   "2024-08-29T14:30:00-07:00"},
                ],
            }],
        })
        camps = _silent(_load_camps, APISource(year=2024), self.config)
        events = camps[0].events
        self.assertEqual(len(events), 1)
        ev = events[0]
        self.assertEqual(ev.parsed_time["kind"], "recurring")
        self.assertEqual(ev.parsed_time["days"], ["Tue", "Wed", "Thu"])
        self.assertEqual(ev.parsed_time["start_time"], "13:00")
        self.assertEqual(ev.parsed_time["end_time"], "14:30")
        self.assertEqual(
            ev.time,
            "Tue–Thu 8/27–8/29 · 1:00 PM – 2:30 PM",
        )

    def test_out_of_window_recurring_fallback_keeps_exact_dates(self):
        """Cards cannot imply a recurrence extends past its API dates."""
        from playa.builder import SiteBuilder

        self._write(2026, {
            "camps": [{
                "uid": "c", "name": "C", "year": 2026,
                "location_string": "",
            }],
            "events": [{
                "uid": "outside", "title": "Before the burn", "year": 2026,
                "hosted_by_camp": "c",
                "occurrence_set": [
                    {
                        "start_time": "2026-08-20T20:00:00-07:00",
                        "end_time": "2026-08-20T22:00:00-07:00",
                    },
                    {
                        "start_time": "2026-08-21T20:00:00-07:00",
                        "end_time": "2026-08-21T22:00:00-07:00",
                    },
                ],
            }],
        })
        camps = _silent(_load_camps, APISource(year=2026), self.config)
        event = camps[0].events[0]
        self.assertEqual(
            event.time,
            "Thu, Fri 8/20–8/21 · 8:00 PM – 10:00 PM",
        )

        SiteBuilder(
            self.config, sources=["api-2026"],
        )._enrich_event_times(camps, source_year=2026)

        self.assertEqual(event.parsed_time["dates"], [])
        self.assertEqual(event.display_time, "")
        # EventItem and Ask deliberately fall back to `time`; it remains dated
        # after the schedule window removes every structured occurrence.
        self.assertEqual(
            event.time,
            "Thu, Fri 8/20–8/21 · 8:00 PM – 10:00 PM",
        )

    def test_mixed_times_split_into_separate_events(self):
        # Different start times per day → one Event per occurrence,
        # ids disambiguated as <uid>, <uid>#1, …
        self._write(2024, {
            "camps": [{"uid": "c", "name": "C", "year": 2024, "location_string": ""}],
            "events": [{
                "uid": "ev",
                "title": "Mixed",
                "year": 2024,
                "hosted_by_camp": "c",
                "occurrence_set": [
                    {"start_time": "2024-08-27T13:00:00-07:00",
                     "end_time":   "2024-08-27T14:00:00-07:00"},
                    {"start_time": "2024-08-28T17:00:00-07:00",
                     "end_time":   "2024-08-28T18:00:00-07:00"},
                ],
            }],
        })
        camps = _silent(_load_camps, APISource(year=2024), self.config)
        events = camps[0].events
        self.assertEqual(len(events), 2)
        ids = sorted(e.id for e in events)
        self.assertEqual(ids, ["ev", "ev#1"])
        # Each is a single-occurrence event.
        for e in events:
            self.assertEqual(e.parsed_time["kind"], "single")

    def test_single_occurrence_event(self):
        self._write(2024, {
            "camps": [{"uid": "c", "name": "C", "year": 2024, "location_string": ""}],
            "events": [{
                "uid": "ev",
                "title": "One-shot",
                "year": 2024,
                "hosted_by_camp": "c",
                "occurrence_set": [
                    {"start_time": "2024-08-27T22:00:00-07:00",
                     "end_time":   "2024-08-27T23:30:00-07:00"},
                ],
            }],
        })
        camps = _silent(_load_camps, APISource(year=2024), self.config)
        ev = camps[0].events[0]
        # One occurrence, single-day, same start/end day → single (not recurring).
        self.assertEqual(ev.parsed_time["kind"], "single")
        self.assertEqual(ev.parsed_time["days"], ["Tue"])
        self.assertEqual(ev.parsed_time["start_time"], "22:00")
        self.assertEqual(ev.parsed_time["end_time"], "23:30")

    def test_utc_occurrence_is_normalized_to_playa_date_before_placement(self):
        # 06:30Z on 9/7 is still closing Sunday (9/6 at 11:30 PM PDT).
        # Normalizing after extracting the date would recreate the original
        # wrong-Sunday class of bug.
        self._write(2026, {
            "camps": [{
                "uid": "c", "name": "C", "year": 2026,
                "location_string": "",
            }],
            "events": [{
                "uid": "utc-closing", "title": "Closing", "year": 2026,
                "hosted_by_camp": "c", "occurrence_set": [{
                    "start_time": "2026-09-07T06:30:00Z",
                    "end_time": "2026-09-07T08:00:00Z",
                }],
            }],
        })
        camps = _silent(_load_camps, APISource(year=2026), self.config)
        event = camps[0].events[0]
        self.assertEqual(event.parsed_time["dates"], ["2026-09-06"])
        self.assertEqual(event.parsed_time["days"], ["Sun"])
        self.assertEqual(event.parsed_time["start_time"], "23:30")
        self.assertEqual(event.parsed_time["end_time"], "01:00")
        self.assertTrue(event.parsed_time["overnight"])

    def test_naive_occurrence_is_dropped_instead_of_using_runner_timezone(self):
        self._write(2026, {
            "camps": [{
                "uid": "c", "name": "C", "year": 2026,
                "location_string": "",
            }],
            "events": [{
                "uid": "naive", "title": "Ambiguous", "year": 2026,
                "hosted_by_camp": "c", "occurrence_set": [{
                    "start_time": "2026-09-06T23:30:00",
                    "end_time": "2026-09-07T01:00:00",
                }],
            }],
        })
        camps = _silent(_load_camps, APISource(year=2026), self.config)
        self.assertEqual(camps[0].events, [])

    def test_source_year_guard_runs_after_playa_normalization(self):
        # Both raw ISO values say 2026, but the occurrence is still 2025 in
        # Black Rock City. It must not cross into api-2026 by UTC date alone.
        self._write(2026, {
            "camps": [{
                "uid": "c", "name": "C", "year": 2026,
                "location_string": "",
            }],
            "events": [{
                "uid": "utc-year-edge", "title": "Boundary", "year": 2026,
                "hosted_by_camp": "c", "occurrence_set": [{
                    "start_time": "2026-01-01T06:00:00Z",
                    "end_time": "2026-01-01T07:00:00Z",
                }],
            }],
        })
        camps = _silent(_load_camps, APISource(year=2026), self.config)
        self.assertEqual(camps[0].events, [])

    def test_builder_places_events_on_exact_occurrence_dates(self):
        # End-to-end API → builder (ADR 11). 2025's window has two Sundays
        # (8/24, 8/31). A lone closing-Sunday event keeps 8/31 (not the opening
        # Sunday); a multi-night overnight event keeps *every* in-window night;
        # an out-of-window night is dropped, never remapped.
        from playa.builder import SiteBuilder
        self._write(2025, {
            "camps": [{"uid": "c", "name": "C", "year": 2025, "location_string": ""}],
            "events": [
                {
                    "uid": "closing", "title": "Closing party", "year": 2025,
                    "hosted_by_camp": "c",
                    "occurrence_set": [
                        {"start_time": "2025-08-31T23:00:00-07:00",
                         "end_time":   "2025-08-31T23:45:00-07:00"},
                    ],
                },
                {
                    "uid": "overnight", "title": "Late night", "year": 2025,
                    "hosted_by_camp": "c",
                    "occurrence_set": [
                        {"start_time": "2025-08-30T23:00:00-07:00",
                         "end_time":   "2025-08-31T01:00:00-07:00"},
                        {"start_time": "2025-08-31T23:00:00-07:00",
                         "end_time":   "2025-09-01T01:00:00-07:00"},
                        # After the window end (9/1) — must be dropped.
                        {"start_time": "2025-09-05T23:00:00-07:00",
                         "end_time":   "2025-09-06T01:00:00-07:00"},
                    ],
                },
            ],
        })
        cfg = Config(
            root=self.root, brc_map_year=2025,
        )
        camps = _silent(_load_camps, APISource(year=2025), cfg)
        SiteBuilder(cfg, sources=["api-2025"])._enrich_event_times(
            camps, source_year=2025,
        )
        by_id = {e.id: e for c in camps for e in c.events}

        closing = by_id["closing"].parsed_time
        self.assertEqual(closing["kind"], "single")
        self.assertEqual(closing["dates"], ["2025-08-31"])  # not opening Sunday
        self.assertEqual(
            by_id["closing"].display_time, "Sun 8/31 · 11:00 PM – 11:45 PM",
        )

        overnight = by_id["overnight"].parsed_time
        self.assertEqual(overnight["kind"], "recurring")
        self.assertEqual(
            overnight["dates"], ["2025-08-30", "2025-08-31"],
        )  # 9/5 dropped
        self.assertTrue(overnight["overnight"])

    def test_occurrence_matrix_covers_both_weeks_and_window_boundaries(self):
        """ADR 11 matrix: single/recurring, both weeks, and overnight edges."""
        from playa.builder import SiteBuilder

        def event(uid, occurrences):
            return {
                "uid": uid, "title": uid, "year": 2026,
                "hosted_by_camp": "c", "occurrence_set": occurrences,
            }

        def occurrence(start, end):
            return {"start_time": start, "end_time": end}

        self._write(2026, {
            "camps": [{
                "uid": "c", "name": "C", "year": 2026,
                "location_string": "",
            }],
            "events": [
                # Single occurrences in week one and week two.
                event("single-week-one", [occurrence(
                    "2026-08-30T10:00:00-07:00",
                    "2026-08-30T11:00:00-07:00",
                )]),
                event("single-week-two", [occurrence(
                    "2026-09-06T10:00:00-07:00",
                    "2026-09-06T11:00:00-07:00",
                )]),
                # Same-time recurrence on the repeated Sunday in both weeks.
                event("recurring-both-weeks", [
                    occurrence(
                        "2026-08-30T12:00:00-07:00",
                        "2026-08-30T13:00:00-07:00",
                    ),
                    occurrence(
                        "2026-09-06T12:00:00-07:00",
                        "2026-09-06T13:00:00-07:00",
                    ),
                ]),
                # A single occurrence may start on the inclusive window end and
                # finish after midnight outside the start-date window.
                event("single-window-end-overnight", [occurrence(
                    "2026-09-07T23:00:00-07:00",
                    "2026-09-08T01:00:00-07:00",
                )]),
                # Recurring overnight starts on both inclusive window edges.
                event("recurring-window-edges-overnight", [
                    occurrence(
                        "2026-08-30T23:00:00-07:00",
                        "2026-08-31T01:00:00-07:00",
                    ),
                    occurrence(
                        "2026-09-07T23:00:00-07:00",
                        "2026-09-08T01:00:00-07:00",
                    ),
                ]),
            ],
        })
        cfg = Config(
            root=self.root, brc_map_year=2026,
        )
        camps = _silent(_load_camps, APISource(year=2026), cfg)
        SiteBuilder(cfg, sources=["api-2026"])._enrich_event_times(
            camps, source_year=2026,
        )
        parsed = {e.id: e.parsed_time for c in camps for e in c.events}

        self.assertEqual(parsed["single-week-one"]["kind"], "single")
        self.assertEqual(parsed["single-week-one"]["dates"], ["2026-08-30"])
        self.assertFalse(parsed["single-week-one"]["overnight"])
        self.assertEqual(parsed["single-week-two"]["kind"], "single")
        self.assertEqual(parsed["single-week-two"]["dates"], ["2026-09-06"])

        self.assertEqual(parsed["recurring-both-weeks"]["kind"], "recurring")
        self.assertEqual(
            parsed["recurring-both-weeks"]["dates"],
            ["2026-08-30", "2026-09-06"],
        )
        self.assertFalse(parsed["recurring-both-weeks"]["overnight"])

        self.assertEqual(parsed["single-window-end-overnight"]["kind"], "single")
        self.assertEqual(
            parsed["single-window-end-overnight"]["dates"], ["2026-09-07"],
        )
        self.assertTrue(parsed["single-window-end-overnight"]["overnight"])
        self.assertEqual(
            parsed["recurring-window-edges-overnight"]["dates"],
            ["2026-08-30", "2026-09-07"],
        )
        self.assertTrue(parsed["recurring-window-edges-overnight"]["overnight"])

    def test_overnight_event_marks_single_kind(self):
        # Crossing midnight in a single occurrence → kind=single (not
        # recurring), so the schedule view's overnight rendering kicks
        # in instead of duplicating the event across days.
        self._write(2024, {
            "camps": [{"uid": "c", "name": "C", "year": 2024, "location_string": ""}],
            "events": [{
                "uid": "ev",
                "title": "Late",
                "year": 2024,
                "hosted_by_camp": "c",
                "occurrence_set": [
                    {"start_time": "2024-08-27T22:00:00-07:00",
                     "end_time":   "2024-08-28T02:00:00-07:00"},
                ],
            }],
        })
        camps = _silent(_load_camps, APISource(year=2024), self.config)
        ev = camps[0].events[0]
        self.assertEqual(ev.parsed_time["kind"], "single")
        self.assertEqual(ev.parsed_time["dates"], ["2024-08-27"])
        self.assertTrue(ev.parsed_time["overnight"])

    def test_source_year_and_new_year_are_hard_occurrence_boundaries(self):
        self._write(2026, {
            "camps": [{
                "uid": "c", "name": "C", "year": 2026,
                "location_string": "",
            }],
            "events": [
                {
                    "uid": "valid", "title": "Valid", "year": 2026,
                    "hosted_by_camp": "c", "occurrence_set": [{
                        "start_time": "2026-08-30T10:00:00-07:00",
                        "end_time": "2026-08-30T11:00:00-07:00",
                    }],
                },
                {
                    "uid": "stale-year", "title": "Stale", "year": 2026,
                    "hosted_by_camp": "c", "occurrence_set": [{
                        "start_time": "2025-08-30T10:00:00-07:00",
                        "end_time": "2025-08-30T11:00:00-07:00",
                    }],
                },
                {
                    "uid": "cross-new-year", "title": "Boundary", "year": 2026,
                    "hosted_by_camp": "c", "occurrence_set": [{
                        "start_time": "2026-12-31T23:00:00-08:00",
                        "end_time": "2027-01-01T01:00:00-08:00",
                    }],
                },
            ],
        })
        camps = _silent(_load_camps, APISource(year=2026), self.config)
        self.assertEqual([event.id for event in camps[0].events], ["valid"])

    def test_historical_source_uses_its_own_annual_window(self):
        from playa.builder import SiteBuilder

        self._write(2025, {
            "camps": [{
                "uid": "c", "name": "C", "year": 2025,
                "location_string": "",
            }],
            "events": [{
                "uid": "opening", "title": "Opening", "year": 2025,
                "hosted_by_camp": "c", "occurrence_set": [{
                    "start_time": "2025-08-24T10:00:00-07:00",
                    "end_time": "2025-08-24T11:00:00-07:00",
                }],
            }],
        })
        cfg = Config(
            root=self.root, brc_map_year=2026,
        )
        camps = _silent(_load_camps, APISource(year=2025), cfg)
        SiteBuilder(cfg, sources=["api-2025"])._enrich_event_times(
            camps, source_year=2025,
        )
        self.assertEqual(
            camps[0].events[0].parsed_time["dates"], ["2025-08-24"],
        )

    def test_denylist_drops_camps_by_uid(self):
        self.config.api_denylist_file.write_text(
            "campA\n# comment\ncampC  # inline ok\n",
        )
        self._write(2024, {
            "camps": [
                {"uid": "campA", "name": "A", "year": 2024, "location_string": ""},
                {"uid": "campB", "name": "B", "year": 2024, "location_string": ""},
                {"uid": "campC", "name": "C", "year": 2024, "location_string": ""},
            ],
            "events": [],
        })
        camps = _silent(_load_camps, APISource(year=2024), self.config)
        self.assertEqual([c.id for c in camps], ["campB"])

    def test_year_below_minimum_rejected_by_fetch(self):
        # `load_camps()` reads from disk and isn't year-restricted,
        # but `fetch_and_cache()` validates year ≥ bm_api_year_min.
        cfg = Config(root=self.root, brc_map_year=2026, bm_api_key="dummy")
        with self.assertRaises(ValueError):
            APISource(year=2010).fetch_and_cache(cfg)

    def test_fetch_without_key_raises(self):
        cfg = Config(root=self.root, brc_map_year=2026)  # bm_api_key default ""
        with self.assertRaises(RuntimeError):
            APISource(year=2024).fetch_and_cache(cfg)

    def test_encrypted_cache_round_trip(self):
        """Encrypted API snapshots decrypt with the cache password."""
        from playa.sources.api import _openssl_encrypt
        cfg = Config(root=self.root, brc_map_year=2026, bm_cache_password="cache-secret")
        cfg.api_dir.mkdir(parents=True, exist_ok=True)
        plaintext = json.dumps({
            "fetched_at": "2026-08-15T12:34:56Z",
            "year": 2024,
            "camps": [{"uid": "u1", "name": "Encrypted Camp", "year": 2024,
                       "location_string": "6:00 & A"}],
            "events": [],
        }).encode("utf-8")
        blob = _openssl_encrypt(plaintext, "cache-secret", cfg.pbkdf2_iter)
        cfg.api_payload_file(2024).write_bytes(blob)
        camps = _silent(_load_camps, APISource(year=2024), cfg)
        self.assertEqual(len(camps), 1)
        self.assertEqual(camps[0].name, "Encrypted Camp")

    def test_encrypted_cache_wrong_password_raises(self):
        from playa.sources.api import _openssl_encrypt
        cfg_write = Config(root=self.root, brc_map_year=2026, bm_cache_password="right")
        cfg_write.api_dir.mkdir(parents=True, exist_ok=True)
        plaintext = json.dumps({
            "fetched_at": "2026-08-15T12:34:56Z",
            "year": 2024,
            "camps": [{"uid": "u1", "name": "X", "year": 2024,
                       "location_string": ""}],
            "events": [],
        }).encode("utf-8")
        blob = _openssl_encrypt(plaintext, "right", cfg_write.pbkdf2_iter)
        cfg_write.api_payload_file(2024).write_bytes(blob)
        cfg_read = Config(root=self.root, brc_map_year=2026, bm_cache_password="wrong")
        with self.assertRaises(RuntimeError) as cm:
            _silent(_load_camps, APISource(year=2024), cfg_read)
        self.assertIn("wrong BM_CACHE_PASSWORD", str(cm.exception))

    def test_encrypted_cache_without_password_helpful_error(self):
        """File on disk is encrypted but config has no password set —
        the error should tell the user which env var to set, not just
        crash on the magic-byte mismatch."""
        from playa.sources.api import _openssl_encrypt
        cfg_write = Config(root=self.root, brc_map_year=2026, bm_cache_password="x")
        cfg_write.api_dir.mkdir(parents=True, exist_ok=True)
        cfg_write.api_payload_file(2024).write_bytes(
            _openssl_encrypt(b'{"fetched_at":"2026-08-15T12:34:56Z","camps":[],"events":[],"art":[]}', "x", cfg_write.pbkdf2_iter),
        )
        cfg_read = Config(root=self.root, brc_map_year=2026)  # no password
        with self.assertRaises(RuntimeError) as cm:
            _load_camps(APISource(year=2024), cfg_read)
        msg = str(cm.exception)
        self.assertIn("BM_CACHE_PASSWORD", msg)
        self.assertIn("SITE_PASSWORD", msg)

    def test_cache_password_falls_back_to_site_password(self):
        """Single-secret deployments: setting just SITE_PASSWORD
        should make the cache key default to it."""
        from playa.sources.api import _openssl_encrypt
        cfg = Config(root=self.root, brc_map_year=2026, site_password="single-secret")
        cfg.api_dir.mkdir(parents=True, exist_ok=True)
        blob = _openssl_encrypt(
            b'{"fetched_at":"2026-08-15T12:34:56Z","camps":[],"events":[],"art":[]}', "single-secret", cfg.pbkdf2_iter,
        )
        cfg.api_payload_file(2024).write_bytes(blob)
        camps = _silent(_load_camps, APISource(year=2024), cfg)
        self.assertEqual(camps, [])


class ConfigAPIYearsTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())

    def test_empty_string_returns_empty_list(self):
        self.assertEqual(
            Config(root=self.root, brc_map_year=2026, bm_api_years="").parsed_api_years(),
            [],
        )

    def test_environment_requires_explicit_current_year(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "BRC_MAP_YEAR is required"):
                Config.from_env(root=self.root)

    def test_environment_accepts_explicit_current_year(self):
        with mock.patch.dict(
            os.environ, {"BRC_MAP_YEAR": "2026"}, clear=True,
        ):
            self.assertEqual(Config.from_env(root=self.root).brc_map_year, 2026)

    def test_plaintext_build_requires_explicit_environment_opt_in(self):
        with mock.patch.dict(
            os.environ,
            {"BRC_MAP_YEAR": "2026", "ALLOW_PLAINTEXT_BUILD": "1"},
            clear=True,
        ):
            self.assertTrue(
                Config.from_env(root=self.root).allow_plaintext_build,
            )
        with mock.patch.dict(
            os.environ,
            {"BRC_MAP_YEAR": "2026", "ALLOW_PLAINTEXT_BUILD": "typo"},
            clear=True,
        ):
            self.assertFalse(
                Config.from_env(root=self.root).allow_plaintext_build,
            )

    def test_environment_rejects_malformed_current_year(self):
        with mock.patch.dict(
            os.environ, {"BRC_MAP_YEAR": "current"}, clear=True,
        ):
            with self.assertRaisesRegex(ValueError, "expected YYYY"):
                Config.from_env(root=self.root)

    def test_parses_csv(self):
        self.assertEqual(
            Config(
                root=self.root, brc_map_year=2026,
                bm_api_years="2024,2025",
            ).parsed_api_years(),
            [2024, 2025],
        )

    def test_strips_whitespace_and_dedupes(self):
        self.assertEqual(
            Config(
                root=self.root, brc_map_year=2026,
                bm_api_years=" 2024 , 2025 , 2024 ",
            ).parsed_api_years(),
            [2024, 2025],
        )

    def test_rejects_below_minimum_year(self):
        with self.assertRaisesRegex(ValueError, "below"):
            Config(
                root=self.root, brc_map_year=2026,
                bm_api_years="2010,2020,2024",
            ).parsed_api_years()

    def test_rejects_non_numeric_entries(self):
        with self.assertRaisesRegex(ValueError, "expected YYYY"):
            Config(
                root=self.root, brc_map_year=2026,
                bm_api_years="2024,latest,2025,",
            ).parsed_api_years()


class CLISourceResolutionTests(unittest.TestCase):
    """Source resolution is API-only and current-year-first."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp())

    def test_explicit_arg_wins_over_env(self):
        from playa.cli import _resolve_sources
        cfg = Config(
            root=self.root, brc_map_year=2026,
            bm_api_years="2024,2025,2026",
        )
        self.assertEqual(
            _resolve_sources("api-2024,api-2026,api-2025", cfg),
            ["api-2026", "api-2025", "api-2024"],
        )

    def test_env_used_when_arg_omitted(self):
        from playa.cli import _resolve_sources
        cfg = Config(
            root=self.root, brc_map_year=2026,
            bm_api_years="2024,2025,2026",
        )
        self.assertEqual(
            _resolve_sources(None, cfg),
            ["api-2026", "api-2025", "api-2024"],
        )

    def test_missing_configuration_is_rejected(self):
        from playa.cli import _resolve_sources
        with self.assertRaisesRegex(ValueError, "no API sources configured"):
            _resolve_sources(None, Config(root=self.root, brc_map_year=2026))

    def test_retired_source_is_rejected(self):
        from playa.cli import _resolve_sources
        with self.assertRaisesRegex(ValueError, "only api-YYYY"):
            _resolve_sources(
                "retired", Config(root=self.root, brc_map_year=2026),
            )

    def test_current_year_is_required(self):
        from playa.cli import _resolve_sources
        with self.assertRaisesRegex(ValueError, "api-2026"):
            _resolve_sources(
                "api-2025", Config(root=self.root, brc_map_year=2026),
            )


class APIRetryTests(unittest.TestCase):
    def test_retries_server_error_with_api_specific_settings(self):
        from playa.sources.api import _request_json
        cfg = Config(
            root=Path(tempfile.mkdtemp()), brc_map_year=2026,
            bm_api_key="key",
            bm_api_retries=2, bm_api_backoff=1,
        )
        failed = mock.Mock(returncode=0, stdout=b'{"detail":"later"}\n500', stderr=b"")
        ok = mock.Mock(returncode=0, stdout=b'{"ok":true}\n200', stderr=b"")
        with mock.patch("playa.sources.api.shutil.which", return_value="/usr/bin/curl"), \
             mock.patch("playa.sources.api.subprocess.run", side_effect=[failed, ok]) as run, \
             mock.patch("playa.sources.api.time.sleep") as sleep:
            self.assertEqual(_request_json(cfg, "/api/camp", {"year": 2026}), {"ok": True})
        self.assertEqual(run.call_count, 2)
        sleep.assert_called_once_with(1)


if __name__ == "__main__":
    unittest.main()
