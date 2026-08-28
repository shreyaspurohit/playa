"""API-only builder, tier, freshness, and service-worker tests."""
from __future__ import annotations

import base64
import contextlib
import gzip
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from playa.builder import SiteBuilder
from playa.config import Config
from playa.models import Art, Camp


HAS_OPENSSL = shutil.which("openssl") is not None


class BuilderFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.config = Config(
            root=self.root,
            camp_location_release_at="2026-08-23T00:00:00-07:00",
            art_location_release_at="2026-08-30T00:00:00-07:00",
            brc_map_year=2026,
            allow_plaintext_build=True,
            pbkdf2_iter=1000,
        )
        self.config.data_dir.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        self.tmp.cleanup()

    def write_cache(self, year: int, *, camps: int = 1, fetched_at: str | None = None):
        self.config.api_dir.mkdir(parents=True, exist_ok=True)
        payload = {
            "fetched_at": fetched_at or f"{year}-08-15T12:34:56Z",
            "year": year,
            "camps": [
                {
                    "uid": f"camp-{year}-{i}",
                    "name": f"Camp {i}",
                    "location_string": "6:00 & A",
                    "description": "tea and art",
                    "url": "https://example.com",
                }
                for i in range(camps)
            ],
            "events": [],
            "art": [{
                "uid": f"art-{year}",
                "name": "API Art",
                "location_string": "The Man",
                "description": "Light",
            }],
        }
        self.config.api_payload_file(year).write_text(json.dumps(payload))

    def write_bundle(self):
        dist = self.root / "client" / "dist"
        dist.mkdir(parents=True, exist_ok=True)
        (dist / "bundle.js").write_text('"use strict";(()=>{})();')
        (dist / "semantic-backend.js").write_text("export const ready=true;")


class SnapshotAndMetadataTests(BuilderFixture):
    def test_build_refuses_implicit_plaintext_payloads(self):
        cfg = Config(
            root=self.root,
            brc_map_year=2026,
            camp_location_release_at="2026-08-23T00:00:00-07:00",
            art_location_release_at="2026-08-30T00:00:00-07:00",
        )
        with self.assertRaisesRegex(
            RuntimeError, "refusing implicit plaintext site build",
        ):
            SiteBuilder(cfg, sources=["api-2026"]).build()

    def test_unknown_current_year_window_is_not_inferred(self):
        unknown = Config(
            root=self.root,
            brc_map_year=2027,
        )
        with self.assertRaisesRegex(RuntimeError, "no reviewed official event window"):
            SiteBuilder(unknown, sources=["api-2027"])

    def test_unknown_historical_source_window_is_not_inferred(self):
        builder = SiteBuilder(self.config, sources=["api-2026", "api-2027"])
        with self.assertRaisesRegex(ValueError, "no reviewed official event window"):
            builder._enrich_event_times([], source_year=2027)

    def test_snapshot_loads_camps_art_and_fetched_at_once(self):
        self.write_cache(2026, fetched_at="2026-08-14T23:45:00Z")
        snapshot = SiteBuilder(self.config, sources=["api-2026"]).load_snapshot_for_source(
            "api-2026",
        )
        self.assertEqual(snapshot.fetched_at, "2026-08-14T23:45:00Z")
        self.assertEqual(len(snapshot.camps), 1)
        self.assertEqual(len(snapshot.art), 1)
        self.assertNotIn("url", snapshot.camps[0].to_dict())
        self.assertNotIn("url", snapshot.art[0].to_dict())

    def test_food_exclusion_path_accepts_api_year_and_rejects_directory(self):
        self.assertEqual(
            self.config.food_exclusion_file("api-2026").name,
            "food-exclusions-api-2026.txt",
        )
        with self.assertRaisesRegex(ValueError, "api-YYYY"):
            self.config.food_exclusion_file("directory")

    def test_reads_api_camp_and_event_food_exclusions(self):
        self.config.food_exclusion_file("api-2026").write_text(
            "# Food only\n"
            "camp:camp-1\n"
            "event:event-1 # inline comment\n",
        )
        builder = SiteBuilder(self.config, sources=["api-2026"])
        self.assertEqual(
            builder.load_food_exclusions("api-2026"),
            {("camp", "camp-1"), ("event", "event-1")},
        )

    def test_rejects_malformed_api_food_exclusion(self):
        self.config.food_exclusion_file("api-2026").write_text("camp-1\n")
        builder = SiteBuilder(self.config, sources=["api-2026"])
        with self.assertRaisesRegex(ValueError, "expected `camp:<id>`"):
            builder.load_food_exclusions("api-2026")

    def test_api_food_exclusions_clear_only_food_classification(self):
        self.config.api_dir.mkdir(parents=True, exist_ok=True)
        self.config.api_payload_file(2026).write_text(json.dumps({
            "fetched_at": "2026-08-15T12:34:56Z",
            "year": 2026,
            "camps": [{
                "uid": "camp-1",
                "name": "Dinner Camp",
                "location_string": "6:00 & A",
                "description": "Free dinner and tea",
            }],
            "events": [{
                "uid": "event-1",
                "title": "Cake service",
                "description": "Serving cake",
                "hosted_by_camp": "camp-1",
                "occurrence_set": [{
                    "start_time": "2026-09-01T14:00:00-07:00",
                    "end_time": "2026-09-01T15:00:00-07:00",
                }],
            }],
            "art": [],
        }))
        self.config.food_exclusion_file("api-2026").write_text(
            "camp:camp-1\nevent:event-1\n",
        )
        snapshot = SiteBuilder(
            self.config, sources=["api-2026"],
        ).load_snapshot_for_source("api-2026")
        camp = snapshot.camps[0]
        self.assertEqual(camp.food_tags, [])
        self.assertIn("food", camp.tags)
        self.assertEqual(camp.location, "6:00 & A")
        self.assertEqual(camp.events[0].food_tags, [])
        self.assertEqual(camp.events[0].name, "Cake service")

    def test_unmatched_api_food_exclusion_warns_without_printing_id(self):
        self.write_cache(2026)
        self.config.food_exclusion_file("api-2026").write_text(
            "camp:private-api-id\n",
        )
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            SiteBuilder(
                self.config, sources=["api-2026"],
            ).load_snapshot_for_source("api-2026")
        self.assertIn("1 Food exclusion(s) did not match", output.getvalue())
        self.assertNotIn("private-api-id", output.getvalue())

    def test_visible_freshness_uses_cache_time_but_version_uses_build_time(self):
        meta = SiteBuilder._build_meta("2025-07-01T01:00:00Z")
        self.assertEqual(meta["fetched_at"], "2025-07-01T01:00:00Z")
        self.assertEqual(meta["fetched_date"], "2025-06-30")
        self.assertRegex(meta["version"], r"^v\d{4}\.\d{2}\.\d{2}\.\d{4}$")
        self.assertNotIn("2025.06.30", meta["version"])

    def test_missing_configured_snapshot_fails_build(self):
        self.write_cache(2026)
        self.write_bundle()
        builder = SiteBuilder(self.config, sources=["api-2026", "api-2025"])
        with mock.patch.dict(os.environ, {"MIN_CAMPS": "0"}, clear=False):
            with self.assertRaises(FileNotFoundError):
                builder.build()

    def test_primary_must_be_current_brc_year(self):
        builder = SiteBuilder(self.config, sources=["api-2025", "api-2026"])
        with self.assertRaisesRegex(RuntimeError, "primary source must be api-2026"):
            builder.build()

    def test_min_camps_applies_to_current_year_snapshot(self):
        self.write_cache(2026, camps=1)
        self.write_bundle()
        with mock.patch.dict(os.environ, {"MIN_CAMPS": "2"}, clear=False):
            with self.assertRaisesRegex(RuntimeError, "api-2026.*only 1 camp"):
                SiteBuilder(self.config, sources=["api-2026"]).build()

    def test_explicit_plain_build_has_api_only_meta_and_cache_freshness(self):
        self.write_cache(2026, fetched_at="2026-08-10T05:06:07Z")
        self.write_cache(2025)
        # A source can contain events before the configured calendar window.
        # Those records must not move the site's first schedule column.
        cache_2025 = self.config.api_payload_file(2025)
        payload_2025 = json.loads(cache_2025.read_text())
        payload_2025["events"] = [{
            "uid": "early-event",
            "title": "Early event",
            "description": "Before the configured burn window",
            "hosted_by_camp": "camp-2025-0",
            "occurrence_set": [{
                "start_time": "2025-08-24T09:00:00-07:00",
                "end_time": "2025-08-24T10:00:00-07:00",
            }],
        }]
        cache_2025.write_text(json.dumps(payload_2025))
        self.write_bundle()
        with mock.patch.dict(os.environ, {"MIN_CAMPS": "0", "BM_EMBEDDINGS": "0"}, clear=False):
            out = SiteBuilder(
                self.config, sources=["api-2026", "api-2025"],
            ).build()
        text = out.read_text()
        self.assertIn('name="bm-sources" content="api-2026,api-2025"', text)
        self.assertIn('name="bm-brc-map-year" content="2026"', text)
        self.assertIn(
            'name="bm-schedule-windows" '
            'content="{&quot;api-2026&quot;:{&quot;start&quot;:'
            '&quot;2026-08-30&quot;,&quot;end&quot;:&quot;2026-09-07&quot;},'
            '&quot;api-2025&quot;:{&quot;start&quot;:&quot;2025-08-24&quot;,'
            '&quot;end&quot;:&quot;2025-09-01&quot;}}"',
            text,
        )
        self.assertIn('name="bm-fetched-at" content="2026-08-10T05:06:07Z"', text)


@unittest.skipUnless(HAS_OPENSSL, "openssl not found on PATH")
class EncryptionAndTierTests(BuilderFixture):
    def camp(self) -> Camp:
        return Camp(
            id="c1", name="Camp", location="6:00 & A",
            description="", website="", events=[],
        )

    def art(self) -> Art:
        return Art(id="a1", name="Art", location="The Man", description="")

    def test_password_encryption_round_trip(self):
        cfg = Config(
            root=self.root, brc_map_year=2026,
            site_password="pw", pbkdf2_iter=1000,
        )
        enc = SiteBuilder(cfg).encrypt_payload(b'{"ok":true}')
        blob = b"Salted__" + base64.b64decode(enc["salt"]) + base64.b64decode(enc["ct"])
        proc = subprocess.run(
            ["openssl", "enc", "-aes-256-cbc", "-d", "-pbkdf2", "-iter", "1000", "-pass", "pass:pw"],
            input=blob, capture_output=True, check=True,
        )
        self.assertEqual(gzip.decompress(proc.stdout), b'{"ok":true}')

    def test_three_tiers_have_expected_api_manifests(self):
        builder = SiteBuilder(self.config, sources=["api-2026", "api-2025"])
        loaded = [("api-2026", [self.camp()]), ("api-2025", [self.camp()])]
        art = [("api-2026", [self.art()]), ("api-2025", [])]
        tiers = [
            ("god-mode", "god", ["api-2026", "api-2025"]),
            ("demigod-mode", "demi", ["api-2026", "api-2025"]),
            ("spirit-mode", "spirit", ["api-2026"]),
        ]
        scripts, meta, _modes, _keys = builder._envelope_data_scripts(loaded, tiers, art)
        self.assertIn("api-2026:0,1,2", meta)
        self.assertIn("api-2025:0,1", meta)
        trusted = meta.split('bm-trusted-wrappers"', 1)[1]
        self.assertIn("api-2026:0", trusted)
        self.assertIn("api-2025:0", trusted)
        self.assertNotIn("api-2026:0,1", trusted)
        self.assertNotIn("retired", scripts)

    def test_unregistered_tier_source_fails(self):
        builder = SiteBuilder(self.config, sources=["api-2026"])
        with self.assertRaisesRegex(RuntimeError, "api-2025"):
            builder._envelope_data_scripts(
                [("api-2026", [self.camp()])],
                [("god-mode", "god", ["api-2026", "api-2025"])],
            )

    def test_spirit_burn_key_contains_only_current_year(self):
        self.write_cache(2026)
        self.write_cache(2025)
        self.write_bundle()
        cfg = Config(
            **{**self.config.__dict__, "site_tiers": (
                "god-mode:god=api-2026+api-2025,"
                "demigod-mode:demi=api-2026+api-2025,"
                "spirit-mode:spirit=api-2026"
            )},
        )
        with contextlib.redirect_stdout(io.StringIO()), mock.patch.dict(
            os.environ, {"MIN_CAMPS": "0", "BURN_OPEN": "1", "BM_EMBEDDINGS": "0"}, clear=False,
        ):
            SiteBuilder(cfg, sources=["api-2026", "api-2025"]).build()
        burn_key = json.loads((cfg.site_dir / "burn-key.json").read_text())
        self.assertEqual(list(burn_key), ["api-2026"])


class ServiceWorkerTests(BuilderFixture):
    def test_activation_purges_pre_cutover_data_caches_but_not_model_cache(self):
        sw_path = SiteBuilder(self.config)._write_service_worker("v2026.08.16.1200")
        sw = sw_path.read_text()
        self.assertIn("const ASK_CACHE = 'playa-ask-v3'", sw)
        self.assertIn("const MODEL_CACHE = 'transformers-cache'", sw)
        # Prefix-based prune: every prior 'playa-' namespace (old shells + pre-v3
        # image/Ask caches, incl. the pre-split single embeddings.json) is deleted,
        # the current three are kept, and transformers-cache (no prefix) survives.
        self.assertIn("k.startsWith('playa-')", sw)
        self.assertIn("k !== CACHE && k !== IMG_CACHE && k !== ASK_CACHE", sw)
        activate = sw.split("self.addEventListener('activate'", 1)[1].split("self.addEventListener('message'", 1)[0]
        self.assertNotIn("caches.delete(MODEL_CACHE)", activate)
        # Per-source indexes are Ask assets; the pre-split single file is gone.
        self.assertIn("const ASK_ASSETS = ['./semantic-backend.js'];", sw)
        self.assertIn(r"/\/embeddings-[\w.-]+\.json$/.test(url.pathname)", sw)


class EmbeddingPartitionTests(BuilderFixture):
    """ADR 21 D9: `_write_embeddings` splits one vectors.json into per-source
    index files with correctly re-sliced int8 rows."""

    def test_splits_vectors_by_source_current_year_first(self):
        emb_dir = self.config.root / "data" / "embeddings"
        emb_dir.mkdir(parents=True, exist_ok=True)
        keys = ["api-2026:camp:1", "api-2025:camp:9", "api-2026:art:2"]
        rows = bytes([1, 2, 3, 4, 5, 6])   # dim=2: row0=[1,2] row1=[3,4] row2=[5,6]
        (emb_dir / "vectors.json").write_text(json.dumps({
            "model": "all-MiniLM-L6-v2", "dim": 2, "q": "int8",
            "sig": "sig-x", "keys": keys,
            "data": base64.b64encode(rows).decode("ascii"),
        }))
        builder = SiteBuilder(self.config, sources=["api-2026", "api-2025"])
        # `subprocess.run` (node embed.mjs) is shelled but mocked to a no-op so it
        # neither runs node nor overwrites our crafted vectors.json.
        with mock.patch("playa.builder.subprocess.run") as run, \
                contextlib.redirect_stdout(io.StringIO()), \
                mock.patch.dict(os.environ, {"BM_EMBEDDINGS": "1"}, clear=False):
            shipped = builder._write_embeddings([("api-2026", []), ("api-2025", [])], [])
        run.assert_called_once()
        self.assertEqual(shipped, ["api-2026", "api-2025"])   # meta manifest order

        p26 = json.loads((self.config.site_dir / "embeddings-api-2026.json").read_text())
        p25 = json.loads((self.config.site_dir / "embeddings-api-2025.json").read_text())
        # Keys keep the full source:kind:id form, grouped by source.
        self.assertEqual(p26["keys"], ["api-2026:camp:1", "api-2026:art:2"])
        self.assertEqual(p25["keys"], ["api-2025:camp:9"])
        # Rows are re-sliced into the correct file (row0+row2 → 2026; row1 → 2025).
        self.assertEqual(base64.b64decode(p26["data"]), bytes([1, 2, 5, 6]))
        self.assertEqual(base64.b64decode(p25["data"]), bytes([3, 4]))
        # sig/dim/model carried through unchanged so the client sig-check passes.
        self.assertEqual((p26["sig"], p26["dim"], p26["model"]), ("sig-x", 2, "all-MiniLM-L6-v2"))

    def test_disabled_returns_empty_manifest(self):
        builder = SiteBuilder(self.config, sources=["api-2026"])
        with mock.patch.dict(os.environ, {"BM_EMBEDDINGS": "0"}, clear=False):
            self.assertEqual(builder._write_embeddings([("api-2026", [])], []), [])


if __name__ == "__main__":
    unittest.main()
