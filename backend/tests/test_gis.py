"""Official annual GIS normalization, validation, and cache tests."""
import json
import io
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError, URLError

from playa.builder import SiteBuilder
from playa.cli import cmd_all, cmd_gis_fetch
from playa.config import Config
from playa.gis import (
    GIS_CACHE_VERSION,
    POI_RULES,
    GisFetcher,
    normalize_gis,
    validate_normalized_gis,
)


def _point_feature(name: str, index: int) -> dict:
    return {
        "type": "Feature",
        "properties": {"NAME": name},
        "geometry": {
            "type": "Point",
            "coordinates": [-119.20 + index * 0.00001, 40.78 + index * 0.00001],
        },
    }


def _cpns(
    year: int,
    *,
    medical_aliases: bool = False,
    omit: set[str] | None = None,
) -> dict:
    features = []
    for index, rule in enumerate(POI_RULES):
        if rule.required_from is not None and year < rule.required_from:
            continue
        name = rule.source_names[0]
        if medical_aliases and name.startswith("ESD Station"):
            name = rule.source_names[1]
        if name in (omit or set()):
            continue
        features.append(_point_feature(name, index))
    features.append(_point_feature("Point 1", len(features)))
    return {"type": "FeatureCollection", "features": features}


def _toilets() -> dict:
    return {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {"OBJECTID": 42, "class": "in city"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [-119.2100, 40.7800],
                    [-119.2098, 40.7800],
                    [-119.2098, 40.7802],
                    [-119.2100, 40.7802],
                    [-119.2100, 40.7800],
                ]],
            },
        }],
    }


def _plazas(name_key: str = "name") -> dict:
    return {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {"OBJECTID": 10, name_key: "Center Camp Plaza"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [-119.2160, 40.7770],
                    [-119.2150, 40.7770],
                    [-119.2150, 40.7780],
                    [-119.2160, 40.7780],
                    [-119.2160, 40.7770],
                ]],
            },
        }],
    }


class NormalizeGisTests(unittest.TestCase):
    def test_curates_points_and_preserves_toilet_geometry(self):
        payload = normalize_gis(2026, _cpns(2026), _plazas(), _toilets())
        self.assertEqual(len(payload["points"]), len(POI_RULES))
        self.assertNotIn("Point 1", {point["source_name"] for point in payload["points"]})
        toilet = payload["toilets"][0]
        self.assertEqual(toilet["id"], "toilet-42")
        self.assertEqual(toilet["layer"], "toilets")
        self.assertEqual(toilet["rings"][0][0], [-119.21, 40.78])
        self.assertAlmostEqual(toilet["lat"], 40.7801, places=5)
        self.assertAlmostEqual(toilet["lng"], -119.2099, places=5)
        by_id = {point["id"]: point for point in payload["points"]}
        self.assertEqual(by_id["center-camp"]["address"], "6:00 & B")
        self.assertEqual(by_id["ice-center"]["address"], "6:15 & B")
        area = payload["areas"][0]
        self.assertEqual(area["id"], "center-camp-plaza")
        self.assertEqual(area["poi_id"], "center-camp")
        self.assertEqual(area["polygons"][0][0][0], [-119.216, 40.777])

    def test_2025_aliases_and_pre_introduction_absence_are_valid(self):
        payload = normalize_gis(
            2025, _cpns(2025, medical_aliases=True), _plazas("Name"), _toilets(),
        )
        by_id = {point["id"]: point for point in payload["points"]}
        self.assertEqual(by_id["medical-3"]["source_name"], "Station 3")
        self.assertNotIn("ice-outpost", by_id)

    def test_missing_required_current_year_point_fails(self):
        with self.assertRaisesRegex(ValueError, "The Temple"):
            normalize_gis(
                2026, _cpns(2026, omit={"The Temple"}), _plazas(), _toilets(),
            )

    def test_normalized_validation_rejects_duplicate_ids(self):
        payload = normalize_gis(2026, _cpns(2026), _plazas(), _toilets())
        payload["toilets"][0]["id"] = payload["points"][0]["id"]
        with self.assertRaisesRegex(ValueError, "duplicate normalized GIS id"):
            validate_normalized_gis(payload, 2026)


class GisFetcherTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.config = Config(root=Path(self.tmp.name))

    def test_fetch_writes_validated_payload_with_provenance_and_reuses_it(self):
        raw = {
            "cpns.geojson": json.dumps(_cpns(2026)).encode(),
            "plazas.geojson": json.dumps(_plazas()).encode(),
            "toilets.geojson": json.dumps(_toilets()).encode(),
        }
        fetcher = GisFetcher(self.config)
        with mock.patch.object(
            fetcher,
            "_download",
            side_effect=lambda _year, filename: raw[filename],
        ) as download:
            path = fetcher.fetch_year(2026, force=True)
            self.assertEqual(download.call_count, 3)
            payload = json.loads(path.read_text())
            self.assertEqual(payload["cache_version"], GIS_CACHE_VERSION)
            self.assertIn("retrieved_at", payload)
            self.assertEqual(len(payload["files"]["cpns.geojson"]["sha256"]), 64)
            fetcher.fetch_year(2026)
            self.assertEqual(download.call_count, 3)

    def test_stale_normalized_cache_is_rebuilt_from_raw_without_download(self):
        out_dir = self.config.gis_year_dir(2026)
        out_dir.mkdir(parents=True)
        raw = {
            "cpns.geojson": json.dumps(_cpns(2026)).encode(),
            "plazas.geojson": json.dumps(_plazas()).encode(),
            "toilets.geojson": json.dumps(_toilets()).encode(),
        }
        for filename, payload in raw.items():
            (out_dir / filename).write_bytes(payload)
        stale = normalize_gis(2026, _cpns(2026), _plazas(), _toilets())
        stale["cache_version"] = GIS_CACHE_VERSION - 1
        normalized_path = self.config.gis_payload_file(2026)
        normalized_path.write_text(json.dumps(stale))

        fetcher = GisFetcher(self.config)
        with mock.patch.object(fetcher, "_download") as download:
            self.assertEqual(fetcher.fetch_year(2026), normalized_path)
        download.assert_not_called()
        rebuilt = json.loads(normalized_path.read_text())
        self.assertEqual(rebuilt["cache_version"], GIS_CACHE_VERSION)
        self.assertEqual(
            {point["id"]: point for point in rebuilt["points"]}["ice-center"]["address"],
            "6:15 & B",
        )

    def test_unpublished_new_year_is_optional(self):
        fetcher = GisFetcher(self.config)
        missing = HTTPError(
            "https://example.test/2027/GeoJSON/cpns.geojson",
            404, "Not Found", {}, None,
        )
        with mock.patch.object(fetcher, "_download", side_effect=missing):
            self.assertIsNone(fetcher.fetch_year(2027, force=True))
        self.assertFalse(self.config.gis_payload_file(2027).exists())

    def test_staged_release_missing_plazas_is_optional(self):
        fetcher = GisFetcher(self.config)
        missing_plazas = HTTPError(
            "https://example.test/2027/GeoJSON/plazas.geojson",
            404, "Not Found", {}, None,
        )

        def download(_year: int, filename: str) -> bytes:
            if filename == "cpns.geojson":
                return json.dumps(_cpns(2027)).encode()
            if filename == "plazas.geojson":
                raise missing_plazas
            self.fail("toilets should not be fetched after the staged 404")

        with mock.patch.object(fetcher, "_download", side_effect=download):
            self.assertIsNone(fetcher.fetch_year(2027, force=True))
        self.assertFalse(self.config.gis_payload_file(2027).exists())

    def test_non_404_http_failure_still_fails(self):
        fetcher = GisFetcher(self.config)
        failure = HTTPError(
            "https://example.test/2027/GeoJSON/cpns.geojson",
            503, "Unavailable", {}, None,
        )
        with mock.patch.object(fetcher, "_download", side_effect=failure):
            with self.assertRaises(HTTPError):
                fetcher.fetch_year(2027, force=True)

    def test_unpublished_forced_refresh_retains_valid_same_year_cache(self):
        normalized_path = self.config.gis_payload_file(2026)
        normalized_path.parent.mkdir(parents=True, exist_ok=True)
        payload = normalize_gis(2026, _cpns(2026), _plazas(), _toilets())
        normalized_path.write_text(json.dumps(payload))
        fetcher = GisFetcher(self.config)
        missing = HTTPError(
            "https://example.test/2026/GeoJSON/cpns.geojson",
            404, "Not Found", {}, None,
        )
        with mock.patch.object(fetcher, "_download", side_effect=missing):
            self.assertEqual(fetcher.fetch_year(2026, force=True), normalized_path)
        validate_normalized_gis(json.loads(normalized_path.read_text()), 2026)


class GisOrchestrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.config = Config(
            root=Path(self.tmp.name),
            burn_start="2026-08-30",
            burn_end="2026-09-07",
        )

    def test_explicit_fetch_remains_strict(self):
        fetcher = mock.Mock()
        fetcher.fetch_year.side_effect = URLError("offline")
        with mock.patch("playa.cli.GisFetcher", return_value=fetcher):
            with self.assertRaises(URLError):
                cmd_gis_fetch(self.config, [2026], force=True)

    def test_best_effort_isolates_each_year_and_warns(self):
        fetcher = mock.Mock()
        fetcher.fetch_year.side_effect = [URLError("offline"), None]
        stderr = io.StringIO()
        with (
            mock.patch("playa.cli.GisFetcher", return_value=fetcher),
            mock.patch.dict("os.environ", {"GITHUB_ACTIONS": ""}),
            redirect_stderr(stderr),
        ):
            cmd_gis_fetch(
                self.config, [2026, 2027], force=True, best_effort=True,
            )
        self.assertEqual(
            fetcher.fetch_year.call_args_list,
            [mock.call(2026, force=True), mock.call(2027, force=True)],
        )
        self.assertIn("GIS 2026 refresh failed", stderr.getvalue())
        self.assertIn("continuing", stderr.getvalue())

    def test_required_name_drift_keeps_valid_cache_and_builds_overlay(self):
        normalized_path = self.config.gis_payload_file(2026)
        normalized_path.parent.mkdir(parents=True, exist_ok=True)
        cached = normalize_gis(2026, _cpns(2026), _plazas(), _toilets())
        cached_bytes = (json.dumps(cached, separators=(",", ":")) + "\n").encode()
        normalized_path.write_bytes(cached_bytes)

        upstream = {
            "cpns.geojson": json.dumps(
                _cpns(2026, omit={"Ranger HQ"}),
            ).encode(),
            "plazas.geojson": json.dumps(_plazas()).encode(),
            "toilets.geojson": json.dumps(_toilets()).encode(),
        }
        stderr = io.StringIO()
        with (
            mock.patch.object(
                GisFetcher,
                "_download",
                side_effect=lambda _year, filename: upstream[filename],
            ),
            redirect_stderr(stderr),
        ):
            cmd_gis_fetch(
                self.config, [2026], force=True, best_effort=True,
            )

        self.assertIn("Ranger Headquarters", stderr.getvalue())
        self.assertEqual(normalized_path.read_bytes(), cached_bytes)
        scripts, embedded = SiteBuilder(self.config)._gis_data_scripts(
            ["directory"],
        )
        self.assertEqual(embedded, ["2026"])
        self.assertIn('id="gis-data-2026"', scripts)

    def test_builder_skips_one_invalid_cache_and_embeds_other_years(self):
        invalid_path = self.config.gis_payload_file(2025)
        invalid_path.parent.mkdir(parents=True, exist_ok=True)
        invalid_path.write_text("{truncated", encoding="utf-8")

        valid_path = self.config.gis_payload_file(2026)
        valid_path.parent.mkdir(parents=True, exist_ok=True)
        valid = normalize_gis(2026, _cpns(2026), _plazas(), _toilets())
        valid_path.write_text(json.dumps(valid), encoding="utf-8")

        stdout = io.StringIO()
        with redirect_stdout(stdout):
            scripts, embedded = SiteBuilder(self.config)._gis_data_scripts(
                ["api-2025", "api-2026"],
            )
        self.assertEqual(embedded, ["2026"])
        self.assertNotIn('id="gis-data-2025"', scripts)
        self.assertIn('id="gis-data-2026"', scripts)
        self.assertIn("GIS 2025 cache unusable", stdout.getvalue())

    def test_nightly_pipeline_uses_best_effort_gis(self):
        sources = ["directory", "api-2025", "api-2026"]
        with (
            mock.patch("playa.cli.cmd_fetch_all"),
            mock.patch("playa.cli.cmd_fetch_art_all"),
            mock.patch("playa.cli.cmd_meta"),
            mock.patch("playa.cli.cmd_merge"),
            mock.patch("playa.cli.cmd_tag"),
            mock.patch("playa.cli.cmd_gis_fetch") as gis_fetch,
            mock.patch("playa.cli.cmd_build") as build,
        ):
            cmd_all(self.config, sources)
        gis_fetch.assert_called_once_with(
            self.config, [2025, 2026], force=False, best_effort=True,
        )
        build.assert_called_once_with(self.config, sources=sources)


if __name__ == "__main__":
    unittest.main()
