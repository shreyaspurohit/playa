"""Annual base-map geometry audit tests."""
from __future__ import annotations

import math
import unittest

from playa.mapaudit import analyze_street_lines, format_typescript_candidate


CENTER_LAT = 40.783242
CENTER_LNG = -119.207871
EARTH_RADIUS_M = 6_371_008.8
FEET_PER_METER = 3.280839895013123


def _destination(radius_feet: float, bearing_deg: float) -> list[float]:
    angular = (radius_feet / FEET_PER_METER) / EARTH_RADIUS_M
    bearing = math.radians(bearing_deg)
    lat1 = math.radians(CENTER_LAT)
    lng1 = math.radians(CENTER_LNG)
    lat2 = math.asin(
        math.sin(lat1) * math.cos(angular)
        + math.cos(lat1) * math.sin(angular) * math.cos(bearing)
    )
    lng2 = lng1 + math.atan2(
        math.sin(bearing) * math.sin(angular) * math.cos(lat1),
        math.cos(angular) - math.sin(lat1) * math.sin(lat2),
    )
    return [math.degrees(lng2), math.degrees(lat2)]


def _line(name: str, radii: list[float], *, kind: str) -> dict:
    return {
        "type": "Feature",
        "properties": {"name": name, "kind": kind, "width_ft": 40},
        "geometry": {
            "type": "LineString",
            "coordinates": [
                _destination(radius, 45 + index * 20)
                for index, radius in enumerate(radii)
            ],
        },
    }


def _fixture() -> dict:
    features = []
    for name, radius in [
        ("ESP", 2498), ("A", 2933), ("B", 3213), ("C", 3493),
        ("D", 3773), ("E", 4058), ("F", 4542),
    ]:
        features.append(_line(name, [radius] * 8, kind="annular"))
    # A connector road changes radius substantially and must not become a
    # letter street merely because upstream labels it annular.
    features.append(_line(
        "Route 66", [2500, 2600, 2750, 2900, 3050, 3200, 3350, 3500],
        kind="annular",
    ))
    # The full radial includes a center spur; matching ring intersections must
    # still derive Esplanade as its render start.
    features.append(_line(
        "3:00", [5, 2498, 2933, 3213, 3493, 3773, 4058, 4542],
        kind="avenue",
    ))
    features.append(_line(
        "3:15", [4542, 4600, 4700, 4800], kind="path",
    ))
    # 12:00 is outside the rendered occupied-city arc and is intentionally
    # omitted from the candidate radial list.
    features.append(_line("12:00", [5, 2498], kind="avenue"))
    return {"type": "FeatureCollection", "features": features}


class MapAuditTests(unittest.TestCase):
    def test_derives_calibrated_radii_and_radial_start_streets(self):
        report = analyze_street_lines(
            year=2027,
            raw=_fixture(),
            center_lat=CENTER_LAT,
            center_lng=CENTER_LNG,
            esplanade_radius_feet=2500,
        )
        candidate = report["typescript_candidate"]
        self.assertEqual(
            candidate["streetRadiiFeet"],
            [2500, 2935, 3215, 3495, 3775, 4060, 4545],
        )
        self.assertEqual(
            candidate["streetLetters"],
            ["Esplanade", "A", "B", "C", "D", "E", "F"],
        )
        self.assertEqual(candidate["radialStreets"], [
            {"clock": "3:00", "innerStreet": "Esplanade"},
            {"clock": "3:15", "innerStreet": "F"},
        ])
        self.assertEqual(
            [item["source_name"] for item in report["excluded_annular_features"]],
            ["Route 66"],
        )
        self.assertIn("property_keys", report["schema"])

    def test_formats_copyable_typescript_without_mutating_source(self):
        report = analyze_street_lines(
            year=2027,
            raw=_fixture(),
            center_lat=CENTER_LAT,
            center_lng=CENTER_LNG,
            esplanade_radius_feet=2500,
        )
        rendered = format_typescript_candidate(report)
        self.assertIn("streetRadiiFeet: [2500, 2935", rendered)
        self.assertIn('{ clock: "3:15", innerStreet: "F" }', rendered)

    def test_rejects_projected_or_swapped_coordinates(self):
        raw = _fixture()
        raw["features"][0]["geometry"]["coordinates"][0] = [40.78, -119.20]
        with self.assertRaisesRegex(ValueError, "outside the BRC region"):
            analyze_street_lines(
                year=2027,
                raw=raw,
                center_lat=CENTER_LAT,
                center_lng=CENTER_LNG,
                esplanade_radius_feet=2500,
            )


if __name__ == "__main__":
    unittest.main()

