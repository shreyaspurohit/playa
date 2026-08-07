"""Read-only annual audit for official BRC street-line GeoJSON.

The runtime map intentionally ships compact, reviewed constants rather than the
full upstream street export.  This module removes the error-prone measuring and
transcription step: it derives candidate annular radii and radial start streets
from a locally downloaded ``street_lines.geojson`` file, while leaving the
actual ``client/src/map/data.ts`` edit behind an explicit human review gate.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from statistics import median
from typing import Any


MAP_AUDIT_VERSION = 1
EARTH_RADIUS_M = 6_371_008.8
FEET_PER_METER = 3.280839895013123
CORE_RING_MAX_MAD_FEET = 50.0
RING_MATCH_TOLERANCE_FEET = 60.0
RADIUS_ROUNDING_FEET = 5


def _coordinate(value: Any) -> tuple[float, float]:
    if not isinstance(value, list) or len(value) < 2:
        raise ValueError(f"street_lines.geojson: invalid coordinate {value!r}")
    lng, lat = value[0], value[1]
    if not isinstance(lng, (int, float)) or not isinstance(lat, (int, float)):
        raise ValueError("street_lines.geojson: coordinate is not numeric")
    lng, lat = float(lng), float(lat)
    if not math.isfinite(lng) or not math.isfinite(lat):
        raise ValueError("street_lines.geojson: coordinate is not finite")
    if not (40.70 <= lat <= 40.90 and -119.35 <= lng <= -119.05):
        raise ValueError(
            "street_lines.geojson: coordinate outside the BRC region: "
            f"{lng}, {lat}"
        )
    return lng, lat


def _distance_feet(
    center_lat: float,
    center_lng: float,
    lat: float,
    lng: float,
) -> float:
    """Haversine distance, matching the client's annual map math."""
    lat1 = math.radians(center_lat)
    lat2 = math.radians(lat)
    dlat = math.radians(lat - center_lat)
    dlng = math.radians(lng - center_lng)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    )
    return (
        2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))
        * FEET_PER_METER
    )


def _percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    index = round((len(ordered) - 1) * fraction)
    return ordered[index]


def _clock_minutes(name: str) -> int | None:
    pieces = name.split(":")
    if len(pieces) != 2:
        return None
    try:
        hour, minute = int(pieces[0]), int(pieces[1])
    except ValueError:
        return None
    if not (0 <= hour <= 12 and minute in (0, 15, 30, 45)):
        return None
    return (hour % 12) * 60 + minute


def _street_labels(count: int) -> list[str]:
    if count < 1 or count > 27:
        raise ValueError(f"unsupported core street count: {count}")
    return ["Esplanade"] + [chr(ord("A") + index) for index in range(count - 1)]


def _rounded_radius(value: float) -> int:
    increment = RADIUS_ROUNDING_FEET
    return int(math.floor(value / increment + 0.5) * increment)


def analyze_street_lines(
    *,
    year: int,
    raw: Any,
    center_lat: float,
    center_lng: float,
    esplanade_radius_feet: float,
    source_path: str = "street_lines.geojson",
    source_sha256: str = "",
) -> dict[str, Any]:
    """Return a deterministic annual geometry audit and TS candidate values.

    The official measurements value for Esplanade calibrates the small offset
    caused by published Golden-Spike coordinate rounding.  Candidate radii are
    rounded to the nearest five feet; the report retains observed medians and
    spread so a reviewer can see exactly what was inferred.
    """
    if not isinstance(raw, dict) or raw.get("type") != "FeatureCollection":
        raise ValueError("street_lines.geojson: expected FeatureCollection")
    features = raw.get("features")
    if not isinstance(features, list) or not features:
        raise ValueError("street_lines.geojson: expected non-empty features")
    if not (40.70 <= center_lat <= 40.90 and -119.35 <= center_lng <= -119.05):
        raise ValueError("Golden Spike coordinate is outside the BRC region")
    if not (1_000 <= esplanade_radius_feet <= 5_000):
        raise ValueError("Esplanade radius must be between 1,000 and 5,000 feet")

    property_keys: set[str] = set()
    geometry_types: set[str] = set()
    by_name: dict[str, list[float]] = {}
    widths_by_name: dict[str, set[float]] = {}
    missing_name_count = 0
    all_lngs: list[float] = []
    all_lats: list[float] = []

    for index, feature in enumerate(features, start=1):
        if not isinstance(feature, dict):
            raise ValueError(f"street_lines.geojson: feature {index} is not an object")
        properties = feature.get("properties")
        geometry = feature.get("geometry")
        if not isinstance(properties, dict) or not isinstance(geometry, dict):
            raise ValueError(f"street_lines.geojson: feature {index} is malformed")
        property_keys.update(str(key) for key in properties)
        geometry_type = geometry.get("type")
        geometry_types.add(str(geometry_type))
        if geometry_type != "LineString":
            raise ValueError(
                f"street_lines.geojson: feature {index} is {geometry_type!r}, "
                "expected LineString"
            )
        coordinates = geometry.get("coordinates")
        if not isinstance(coordinates, list) or len(coordinates) < 2:
            raise ValueError(
                f"street_lines.geojson: feature {index} has fewer than 2 coordinates"
            )
        parsed_coordinates = [_coordinate(value) for value in coordinates]
        for lng, lat in parsed_coordinates:
            all_lngs.append(lng)
            all_lats.append(lat)
        name = properties.get("name") or properties.get("Name") or properties.get("NAME")
        if not isinstance(name, str) or not name.strip():
            missing_name_count += 1
            continue
        name = name.strip()
        distances = by_name.setdefault(name, [])
        for lng, lat in parsed_coordinates:
            distances.append(_distance_feet(center_lat, center_lng, lat, lng))
        width = properties.get("width_ft", properties.get("width"))
        try:
            if width is not None:
                widths_by_name.setdefault(name, set()).add(float(width))
        except (TypeError, ValueError):
            pass

    annular: list[dict[str, Any]] = []
    excluded_annular: list[dict[str, Any]] = []
    radial_groups: dict[str, list[float]] = {}
    for name, distances in by_name.items():
        clock = _clock_minutes(name)
        if clock is not None:
            if 2 * 60 <= clock <= 10 * 60:
                radial_groups[name] = distances
            continue
        observed = median(distances)
        median_absolute_deviation = median(
            abs(distance - observed) for distance in distances
        )
        p05 = _percentile(distances, 0.05)
        p95 = _percentile(distances, 0.95)
        entry = {
            "source_name": name,
            "observed_radius_feet": round(observed, 1),
            "p05_feet": round(p05, 1),
            "p95_feet": round(p95, 1),
            "robust_spread_feet": round(p95 - p05, 1),
            "median_absolute_deviation_feet": round(
                median_absolute_deviation, 1,
            ),
            "vertex_count": len(distances),
            "widths_feet": sorted(widths_by_name.get(name, set())),
        }
        # True annular streets are almost constant-radius, but keyholes and
        # special center-camp segments can create a minority of large outliers
        # (notably 2025 Esplanade). MAD keeps those rings while excluding
        # connector roads such as 2026 Rods Road and Route 66 whose typical
        # vertices genuinely span several radii.
        if median_absolute_deviation <= CORE_RING_MAX_MAD_FEET:
            annular.append(entry)
        else:
            excluded_annular.append(entry)

    annular.sort(key=lambda entry: entry["observed_radius_feet"])
    excluded_annular.sort(key=lambda entry: entry["observed_radius_feet"])
    if len(annular) < 3:
        raise ValueError("street_lines.geojson: fewer than 3 uniform core annular streets")
    labels = _street_labels(len(annular))
    esplanade = annular[0]
    offset = esplanade_radius_feet - float(esplanade["observed_radius_feet"])
    candidate_radii: list[int] = []
    for label, entry in zip(labels, annular):
        candidate = _rounded_radius(float(entry["observed_radius_feet"]) + offset)
        entry["street_label"] = label
        entry["candidate_radius_feet"] = candidate
        candidate_radii.append(candidate)
    if any(b <= a for a, b in zip(candidate_radii, candidate_radii[1:])):
        raise ValueError("derived candidate street radii are not strictly increasing")

    radial_streets: list[dict[str, Any]] = []
    for clock, distances in sorted(
        radial_groups.items(), key=lambda pair: _clock_minutes(pair[0]) or 0,
    ):
        matching_index = next((
            index
            for index, entry in enumerate(annular)
            if min(
                abs(distance - float(entry["observed_radius_feet"]))
                for distance in distances
            ) <= RING_MATCH_TOLERANCE_FEET
        ), None)
        if matching_index is None:
            raise ValueError(
                f"street_lines.geojson: radial {clock} does not meet a core street"
            )
        radial_streets.append({
            "clock": clock,
            "inner_street": labels[matching_index],
            "inner_source_name": annular[matching_index]["source_name"],
            "observed_min_radius_feet": round(min(distances), 1),
            "observed_max_radius_feet": round(max(distances), 1),
            "vertex_count": len(distances),
        })
    if not radial_streets:
        raise ValueError("street_lines.geojson: no 2:00–10:00 radial streets")

    warnings: list[str] = []
    if missing_name_count:
        warnings.append(f"{missing_name_count} LineString features have no recognized name")
    if excluded_annular:
        warnings.append(
            "Excluded non-uniform annular features from the core grid: "
            + ", ".join(entry["source_name"] for entry in excluded_annular)
        )

    return {
        "report_version": MAP_AUDIT_VERSION,
        "year": year,
        "source": {
            "path": source_path,
            "sha256": source_sha256,
        },
        "center": {"lat": center_lat, "lng": center_lng},
        "schema": {
            "feature_count": len(features),
            "geometry_types": sorted(geometry_types),
            "property_keys": sorted(property_keys),
            "features_without_name": missing_name_count,
            "bounds": [min(all_lngs), min(all_lats), max(all_lngs), max(all_lats)],
        },
        "calibration": {
            "esplanade_source_name": esplanade["source_name"],
            "observed_radius_feet": esplanade["observed_radius_feet"],
            "official_radius_feet": esplanade_radius_feet,
            "offset_feet": round(offset, 1),
            "rounding_increment_feet": RADIUS_ROUNDING_FEET,
        },
        "core_annular_streets": annular,
        "excluded_annular_features": excluded_annular,
        "radial_streets": radial_streets,
        "typescript_candidate": {
            "streetRadiiFeet": candidate_radii,
            "streetLetters": labels,
            "radialStreets": [
                {"clock": entry["clock"], "innerStreet": entry["inner_street"]}
                for entry in radial_streets
            ],
        },
        "warnings": warnings,
    }


def audit_street_lines_file(
    *,
    year: int,
    path: Path,
    center_lat: float,
    center_lng: float,
    esplanade_radius_feet: float,
) -> dict[str, Any]:
    payload = path.read_bytes()
    try:
        raw = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{path}: invalid JSON: {exc}") from exc
    return analyze_street_lines(
        year=year,
        raw=raw,
        center_lat=center_lat,
        center_lng=center_lng,
        esplanade_radius_feet=esplanade_radius_feet,
        source_path=str(path),
        source_sha256=hashlib.sha256(payload).hexdigest(),
    )


def format_typescript_candidate(report: dict[str, Any]) -> str:
    """Format only the generated fields; all other annual values stay manual."""
    candidate = report["typescript_candidate"]
    radii = ", ".join(str(value) for value in candidate["streetRadiiFeet"])
    letters = ", ".join(json.dumps(value) for value in candidate["streetLetters"])
    radials = "\n".join(
        "    { clock: " + json.dumps(entry["clock"])
        + ", innerStreet: " + json.dumps(entry["innerStreet"]) + " },"
        for entry in candidate["radialStreets"]
    )
    return (
        f"streetRadiiFeet: [{radii}],\n"
        f"streetLetters: [{letters}],\n"
        "radialStreets: [\n" + radials + "\n  ],"
    )
