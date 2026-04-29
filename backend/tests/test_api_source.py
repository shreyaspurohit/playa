"""Unit tests for playa.sources.api — schema mapping + cache loading.

The HTTP path (`fetch_and_cache`) talks to api.burningman.org and is
not exercised here; we test against a hand-crafted JSON file written
to the cache location, which is exactly what `load_camps()` reads in
production.
"""
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from playa.config import Config
from playa.sources.api import APISource


def _silent(fn, *args, **kwargs):
    with contextlib.redirect_stdout(io.StringIO()):
        return fn(*args, **kwargs)


class APISourceLoadTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.config = Config(root=self.root)
        self.config.api_dir.mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def _write(self, year, payload):
        self.config.api_payload_file(year).write_text(json.dumps(payload))

    def test_missing_cache_raises_with_helpful_message(self):
        src = APISource(year=2024)
        with self.assertRaises(FileNotFoundError) as cm:
            src.load_camps(self.config)
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
        camps = _silent(APISource(year=2024).load_camps, self.config)
        self.assertEqual(len(camps), 1)
        c = camps[0]
        self.assertEqual(c.id, "a1XVI000001vN7N2AU")
        self.assertEqual(c.name, "Census")
        self.assertEqual(c.location, "Esplanade & 6:30")
        self.assertEqual(c.description, "We count things.")
        self.assertEqual(c.website, "http://census.burningman.org")
        # API-source camps have no canonical "directory page" URL — UI
        # omits the link when this is empty.
        self.assertEqual(c.url, "")

    def test_camp_without_uid_is_dropped(self):
        self._write(2024, {
            "camps": [
                {"name": "no-uid", "year": 2024, "location_string": ""},
                {"uid": "valid", "name": "ok", "year": 2024, "location_string": ""},
            ],
            "events": [],
        })
        camps = _silent(APISource(year=2024).load_camps, self.config)
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
        camps = _silent(APISource(year=2024).load_camps, self.config)
        a = next(c for c in camps if c.id == "campA")
        b = next(c for c in camps if c.id == "campB")
        self.assertEqual([e.id for e in a.events], ["evA1"])
        self.assertEqual([e.id for e in b.events], ["evB1"])

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
        camps = _silent(APISource(year=2024).load_camps, self.config)
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
        camps = _silent(APISource(year=2024).load_camps, self.config)
        events = camps[0].events
        self.assertEqual(len(events), 1)
        ev = events[0]
        self.assertEqual(ev.parsed_time["kind"], "recurring")
        self.assertEqual(ev.parsed_time["days"], ["Tue", "Wed", "Thu"])
        self.assertEqual(ev.parsed_time["start_time"], "13:00")
        self.assertEqual(ev.parsed_time["end_time"], "14:30")

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
        camps = _silent(APISource(year=2024).load_camps, self.config)
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
        camps = _silent(APISource(year=2024).load_camps, self.config)
        ev = camps[0].events[0]
        # One occurrence, single-day, same start/end day → single (not recurring).
        self.assertEqual(ev.parsed_time["kind"], "single")
        self.assertEqual(ev.parsed_time["days"], ["Tue"])
        self.assertEqual(ev.parsed_time["start_time"], "22:00")
        self.assertEqual(ev.parsed_time["end_time"], "23:30")

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
        camps = _silent(APISource(year=2024).load_camps, self.config)
        ev = camps[0].events[0]
        self.assertEqual(ev.parsed_time["kind"], "single")
        self.assertEqual(ev.parsed_time["start_day"], "Tue")
        self.assertEqual(ev.parsed_time["end_day"], "Wed")

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
        camps = _silent(APISource(year=2024).load_camps, self.config)
        self.assertEqual([c.id for c in camps], ["campB"])

    def test_year_below_minimum_rejected_by_fetch(self):
        # `load_camps()` reads from disk and isn't year-restricted,
        # but `fetch_and_cache()` validates year ≥ bm_api_year_min.
        cfg = Config(root=self.root, bm_api_key="dummy")
        with self.assertRaises(ValueError):
            APISource(year=2010).fetch_and_cache(cfg)

    def test_fetch_without_key_raises(self):
        cfg = Config(root=self.root)  # bm_api_key default ""
        with self.assertRaises(RuntimeError):
            APISource(year=2024).fetch_and_cache(cfg)

    def test_encrypted_cache_round_trip(self):
        """Write encrypted cache via _openssl_encrypt → load_camps()
        decrypts on read using the same password."""
        from playa.sources.api import _openssl_encrypt
        cfg = Config(root=self.root, bm_cache_password="cache-secret")
        cfg.api_dir.mkdir(parents=True, exist_ok=True)
        plaintext = json.dumps({
            "year": 2024,
            "camps": [{"uid": "u1", "name": "Encrypted Camp", "year": 2024,
                       "location_string": "6:00 & A"}],
            "events": [],
        }).encode("utf-8")
        blob = _openssl_encrypt(plaintext, "cache-secret", cfg.pbkdf2_iter)
        cfg.api_payload_file(2024).write_bytes(blob)
        camps = _silent(APISource(year=2024).load_camps, cfg)
        self.assertEqual(len(camps), 1)
        self.assertEqual(camps[0].name, "Encrypted Camp")

    def test_encrypted_cache_wrong_password_raises(self):
        from playa.sources.api import _openssl_encrypt
        cfg_write = Config(root=self.root, bm_cache_password="right")
        cfg_write.api_dir.mkdir(parents=True, exist_ok=True)
        plaintext = json.dumps({
            "year": 2024,
            "camps": [{"uid": "u1", "name": "X", "year": 2024,
                       "location_string": ""}],
            "events": [],
        }).encode("utf-8")
        blob = _openssl_encrypt(plaintext, "right", cfg_write.pbkdf2_iter)
        cfg_write.api_payload_file(2024).write_bytes(blob)
        cfg_read = Config(root=self.root, bm_cache_password="wrong")
        with self.assertRaises(RuntimeError) as cm:
            _silent(APISource(year=2024).load_camps, cfg_read)
        self.assertIn("wrong BM_CACHE_PASSWORD", str(cm.exception))

    def test_encrypted_cache_without_password_helpful_error(self):
        """File on disk is encrypted but config has no password set —
        the error should tell the user which env var to set, not just
        crash on the magic-byte mismatch."""
        from playa.sources.api import _openssl_encrypt
        cfg_write = Config(root=self.root, bm_cache_password="x")
        cfg_write.api_dir.mkdir(parents=True, exist_ok=True)
        cfg_write.api_payload_file(2024).write_bytes(
            _openssl_encrypt(b'{"camps":[],"events":[]}', "x", cfg_write.pbkdf2_iter),
        )
        cfg_read = Config(root=self.root)  # no password
        with self.assertRaises(RuntimeError) as cm:
            APISource(year=2024).load_camps(cfg_read)
        msg = str(cm.exception)
        self.assertIn("BM_CACHE_PASSWORD", msg)
        self.assertIn("SITE_PASSWORD", msg)

    def test_cache_password_falls_back_to_site_password(self):
        """Single-secret deployments: setting just SITE_PASSWORD
        should make the cache key default to it."""
        from playa.sources.api import _openssl_encrypt
        cfg = Config(root=self.root, site_password="single-secret")
        cfg.api_dir.mkdir(parents=True, exist_ok=True)
        blob = _openssl_encrypt(
            b'{"camps":[],"events":[]}', "single-secret", cfg.pbkdf2_iter,
        )
        cfg.api_payload_file(2024).write_bytes(blob)
        camps = _silent(APISource(year=2024).load_camps, cfg)
        self.assertEqual(camps, [])


class ConfigAPIYearsTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())

    def test_empty_string_returns_empty_list(self):
        self.assertEqual(Config(root=self.root, bm_api_years="").parsed_api_years(), [])

    def test_parses_csv(self):
        self.assertEqual(
            Config(root=self.root, bm_api_years="2024,2025").parsed_api_years(),
            [2024, 2025],
        )

    def test_strips_whitespace_and_dedupes(self):
        self.assertEqual(
            Config(root=self.root, bm_api_years=" 2024 , 2025 , 2024 ").parsed_api_years(),
            [2024, 2025],
        )

    def test_drops_below_minimum_year(self):
        self.assertEqual(
            Config(root=self.root, bm_api_years="2010,2020,2024").parsed_api_years(),
            [2020, 2024],
        )

    def test_drops_non_numeric_entries(self):
        self.assertEqual(
            Config(root=self.root, bm_api_years="2024,latest,2025,").parsed_api_years(),
            [2024, 2025],
        )


class CLISourceResolutionTests(unittest.TestCase):
    """`_resolve_sources` dispatch: arg > BM_API_YEARS > default."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp())

    def test_explicit_arg_wins_over_env(self):
        from playa.cli import _resolve_sources
        cfg = Config(root=self.root, bm_api_years="2024,2025")
        self.assertEqual(
            _resolve_sources("directory", cfg),
            ["directory"],
        )

    def test_env_used_when_arg_omitted(self):
        from playa.cli import _resolve_sources
        cfg = Config(root=self.root, bm_api_years="2024,2025")
        self.assertEqual(
            _resolve_sources(None, cfg),
            ["directory", "api-2024", "api-2025"],
        )

    def test_default_directory_only(self):
        from playa.cli import _resolve_sources
        cfg = Config(root=self.root)  # no env, no arg
        self.assertEqual(_resolve_sources(None, cfg), ["directory"])


if __name__ == "__main__":
    unittest.main()
