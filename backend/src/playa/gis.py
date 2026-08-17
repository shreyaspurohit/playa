"""Official Burning Man GIS fetch + normalization.

The upstream annual GeoJSON mixes participant-facing destinations with
operational survey nodes.  This module keeps geometry year-specific while a
small, reviewed allowlist supplies stable ids, layers, icons, and user-facing
copy.  Raw and normalized payloads live under ``data/gis/<year>/`` and are
gitignored; the builder embeds the normalized snapshot for offline use.
"""
from __future__ import annotations

import json
import hashlib
import math
import os
import tempfile
import urllib.request
from urllib.error import HTTPError
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import Config


GIS_FILENAMES = ("cpns.geojson", "plazas.geojson", "toilets.geojson")
GIS_CACHE_VERSION = 3


@dataclass(frozen=True)
class PoiRule:
    """Presentation metadata for one official CPN feature."""

    id: str
    source_names: tuple[str, ...]
    name: str
    kind: str
    layer: str
    address: str
    description: str
    required: bool = False
    required_from: int | None = None


@dataclass(frozen=True)
class AreaRule:
    """Presentation metadata for one official annual polygon."""

    id: str
    source_names: tuple[str, ...]
    name: str
    kind: str
    layer: str
    poi_id: str


# Names are the official CPN ``NAME`` values observed in 2026.  Aliases let a
# later annual export rename a location without changing stable client ids.
# New aliases are reviewed against that year's Survival Guide before landing.
POI_RULES: tuple[PoiRule, ...] = (
    PoiRule("center-camp", ("Center Camp Plaza", "Center Camp"), "Center Camp Plaza", "center-camp", "base",
            "6:00 & B", "The Canopy and Center Camp community hub.", True),
    PoiRule("temple", ("The Temple",), "The Temple", "temple", "base",
            "12:00 open playa", "The Temple and surrounding open-playa landmark.", True),
    PoiRule("medical-3", ("ESD Station 3", "Station 3"), "Medical / ESD — 3:00", "medical", "base",
            "3:00 & C", "Emergency medical, fire, and crisis support.", True),
    PoiRule("medical-6", ("ESD Station 6", "Station 6"), "Medical / ESD — 6:00", "medical", "base",
            "5:15 & Esplanade", "Emergency medical, fire, and crisis support.", True),
    PoiRule("medical-9", ("ESD Station 9", "Station 9"), "Medical / ESD — 9:00", "medical", "base",
            "9:00 & C", "Emergency medical, fire, and crisis support.", True),
    PoiRule("ranger-3", ("Ranger Station Berlin",), "Ranger Outpost — 3:00", "ranger", "base",
            "3:00 & C", "Black Rock Rangers: help, mediation, safety, and emergency radio access.", True),
    PoiRule("ranger-6", ("Ranger HQ",), "Ranger Headquarters", "ranger", "base",
            "6:30 & Esplanade", "Black Rock Rangers are available here 24/7 during the event.", True),
    PoiRule("ranger-9", ("Ranger Station Tokyo",), "Ranger Outpost — 9:00", "ranger", "base",
            "9:00 & C", "Black Rock Rangers: help, mediation, safety, and emergency radio access.", True),

    PoiRule("ice-3", ("Ice Cubed Arctica 3",), "Arctica Ice — 3:00", "ice", "essentials",
            "3:00 & G", "Participant ice sales; check the current Survival Guide for hours.", True),
    PoiRule("ice-center", ("Arctica Center Camp",), "Arctica Ice — Center Camp", "ice", "essentials",
            "6:15 & B", "Participant ice sales; check the current Survival Guide for hours.", True),
    PoiRule("ice-9", ("Ice Nine Arctica",), "Arctica Ice — 9:00", "ice", "essentials",
            "9:00 & G", "Participant ice sales; check the current Survival Guide for hours.", True),
    PoiRule("ice-outpost", ("Arctica Outpost",), "Arctica Large Order Outpost", "ice", "essentials",
            "6:15 & K", "Large-order ice sales; cash-free and the only ice location with vehicle parking.",
            True, 2026),

    PoiRule("playa-info", ("Playa Info",), "Playa Info · Placement · Lost & Found", "info", "services",
            "5:45 & Esplanade", "Camp lookup, information, Placement help, Lost & Found, ASL, and message boards.", True),
    PoiRule("artery", ("Artery",), "ARTery", "art-services", "services",
            "6:30 & Esplanade", "Art information, burn schedules, tours, artist talks, and incident reports."),
    PoiRule("recycle", ("Recycle Camp",), "Recycle Camp", "recycle", "services",
            "5:35 & Esplanade", "Drop off sorted, pre-crushed aluminum cans during posted hours."),
    PoiRule("yellow-bike", ("Yellow Bike Project",), "Yellow Bike Shop", "bike", "services",
            "5:30 & D", "Community-bike support and the destination for disabled or lost Yellow Bikes."),

    PoiRule("bus-depot", ("Burner Express Bus Depot",), "Burner Express Bus Depot", "bus", "transport",
            "6:00 outer city", "Burner Express arrivals, departures, and pre-purchased water pickup."),
    PoiRule("airport", ("Airport",), "Black Rock City Airport", "airport", "transport",
            "5:00 at the perimeter", "BRC Municipal Airport (88NV) and Burner Express Air access."),

    PoiRule("dmv", ("Department of Mutant Vehicles (DMV)", "DMV"), "Department of Mutant Vehicles", "dmv", "arrival",
            "6:30 & Esplanade", "Mutant-vehicle and accessibility-vehicle inspection and licensing."),
    PoiRule("media-mecca", ("Media Mecca",), "Media Mecca", "media", "arrival",
            "6:15 & Esplanade", "Required check-in and support for registered professional media."),
    PoiRule("greeters", ("Greeters",), "Greeters", "greeters", "arrival",
            "Entry road", "Welcome and orientation after Gate."),
    PoiRule("gate", ("Gate Actual",), "Main Gate", "gate", "arrival",
            "Gate Road", "Main vehicle entrance to Black Rock City."),
    PoiRule("box-office", ("Box Office",), "Box Office", "box-office", "arrival",
            "Outside Main Gate", "Ticket and credential assistance; accessible by motor vehicle."),
    PoiRule("will-call", ("Will Call Lot",), "Will Call", "will-call", "arrival",
            "Outside Main Gate", "Will Call parking and ticket pickup near the Box Office."),
)


# Keep annual footprints separate from the CPN point used for selection and
# navigation.  The stable ``poi_id`` connects a polygon tap to that point's
# existing label/details behavior without duplicating it in the landmarks list.
AREA_RULES: tuple[AreaRule, ...] = (
    AreaRule(
        "center-camp-plaza",
        ("Center Camp Plaza",),
        "Center Camp Plaza",
        "center-camp",
        "base",
        "center-camp",
    ),
)


def _feature_collection(raw: Any, filename: str) -> list[dict[str, Any]]:
    if not isinstance(raw, dict) or raw.get("type") != "FeatureCollection":
        raise ValueError(f"{filename}: expected GeoJSON FeatureCollection")
    features = raw.get("features")
    if not isinstance(features, list) or not features:
        raise ValueError(f"{filename}: expected a non-empty features array")
    return features


def _coordinate(value: Any, filename: str) -> tuple[float, float]:
    if not isinstance(value, list) or len(value) < 2:
        raise ValueError(f"{filename}: invalid coordinate {value!r}")
    lng, lat = value[0], value[1]
    if not isinstance(lng, (int, float)) or not isinstance(lat, (int, float)):
        raise ValueError(f"{filename}: coordinate is not numeric")
    lng, lat = float(lng), float(lat)
    if not math.isfinite(lng) or not math.isfinite(lat):
        raise ValueError(f"{filename}: coordinate is not finite")
    # Generous region guard: catches swapped or projected coordinates without
    # rejecting arrival infrastructure outside the trash fence.
    if not (40.70 <= lat <= 40.90 and -119.35 <= lng <= -119.05):
        raise ValueError(f"{filename}: coordinate outside the BRC region: {lng}, {lat}")
    return lng, lat


def _ring_centroid(ring: list[list[float]], filename: str) -> tuple[float, float]:
    """Area-weighted centroid with a mean fallback for degenerate rings."""
    points = [_coordinate(p, filename) for p in ring]
    if len(points) < 3:
        raise ValueError(f"{filename}: polygon ring has fewer than 3 points")
    # Work in coordinates translated near zero. Applying the shoelace formula
    # directly to longitude≈-119 and latitude≈41 subtracts nearly equal large
    # products and loses enough precision to move a small toilet-bank centroid
    # by tens of metres.
    origin_x, origin_y = points[0]
    local = [(x - origin_x, y - origin_y) for x, y in points]
    twice_area = 0.0
    cx = 0.0
    cy = 0.0
    for i, (x1, y1) in enumerate(local):
        x2, y2 = local[(i + 1) % len(local)]
        cross = x1 * y2 - x2 * y1
        twice_area += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    if abs(twice_area) < 1e-15:
        return (
            sum(p[0] for p in points) / len(points),
            sum(p[1] for p in points) / len(points),
        )
    return (
        origin_x + cx / (3 * twice_area),
        origin_y + cy / (3 * twice_area),
    )


def _polygon_geometry(
    geometry: Any,
    filename: str,
) -> list[list[list[list[float]]]]:
    """Return GeoJSON polygons as ``[polygon][ring][point][lng,lat]``."""
    if not isinstance(geometry, dict):
        raise ValueError(f"{filename}: polygon feature has no geometry")
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "Polygon":
        raw_polygons = [coordinates]
    elif geometry_type == "MultiPolygon":
        raw_polygons = coordinates
    else:
        raise ValueError(
            f"{filename}: expected Polygon or MultiPolygon, got {geometry_type!r}"
        )
    if not isinstance(raw_polygons, list) or not raw_polygons:
        raise ValueError(f"{filename}: polygon feature has no coordinates")

    polygons: list[list[list[list[float]]]] = []
    for raw_polygon in raw_polygons:
        if not isinstance(raw_polygon, list) or not raw_polygon:
            raise ValueError(f"{filename}: polygon has no rings")
        rings: list[list[list[float]]] = []
        for raw_ring in raw_polygon:
            if not isinstance(raw_ring, list) or len(raw_ring) < 3:
                raise ValueError(f"{filename}: polygon has an invalid ring")
            rings.append([
                [lng, lat]
                for lng, lat in (
                    _coordinate(pair, filename) for pair in raw_ring
                )
            ])
        polygons.append(rings)
    return polygons


def normalize_gis(
    year: int,
    cpns: Any,
    plazas: Any,
    toilets: Any,
) -> dict[str, Any]:
    """Validate upstream GeoJSON and return the compact client schema."""
    cpn_features = _feature_collection(cpns, "cpns.geojson")
    by_name: dict[str, dict[str, Any]] = {}
    for feature in cpn_features:
        if not isinstance(feature, dict):
            continue
        geometry = feature.get("geometry") or {}
        properties = feature.get("properties") or {}
        if geometry.get("type") != "Point" or not isinstance(properties, dict):
            continue
        name = properties.get("NAME")
        if isinstance(name, str) and name:
            by_name[name] = feature

    points: list[dict[str, Any]] = []
    missing_required: list[str] = []
    for rule in POI_RULES:
        source_name = next((name for name in rule.source_names if name in by_name), None)
        if source_name is None:
            if rule.required and (rule.required_from is None or year >= rule.required_from):
                missing_required.append(rule.name)
            continue
        feature = by_name[source_name]
        lng, lat = _coordinate(feature["geometry"].get("coordinates"), "cpns.geojson")
        points.append({
            "id": rule.id,
            "name": rule.name,
            "source_name": source_name,
            "kind": rule.kind,
            "layer": rule.layer,
            "address": rule.address,
            "description": rule.description,
            "lat": lat,
            "lng": lng,
        })
    if missing_required:
        raise ValueError(
            f"{year} cpns.geojson is missing required participant POIs: "
            + ", ".join(missing_required)
        )

    plaza_features = _feature_collection(plazas, "plazas.geojson")
    plazas_by_name: dict[str, dict[str, Any]] = {}
    for feature in plaza_features:
        if not isinstance(feature, dict):
            continue
        properties = feature.get("properties") or {}
        if not isinstance(properties, dict):
            continue
        source_name = (
            properties.get("name")
            or properties.get("Name")
            or properties.get("NAME")
        )
        if isinstance(source_name, str) and source_name:
            plazas_by_name[source_name] = feature

    areas: list[dict[str, Any]] = []
    missing_areas: list[str] = []
    for rule in AREA_RULES:
        source_name = next(
            (name for name in rule.source_names if name in plazas_by_name),
            None,
        )
        if source_name is None:
            missing_areas.append(rule.name)
            continue
        feature = plazas_by_name[source_name]
        areas.append({
            "id": rule.id,
            "name": rule.name,
            "source_name": source_name,
            "kind": rule.kind,
            "layer": rule.layer,
            "poi_id": rule.poi_id,
            "polygons": _polygon_geometry(
                feature.get("geometry"), "plazas.geojson"
            ),
        })
    if missing_areas:
        raise ValueError(
            f"{year} plazas.geojson is missing required participant areas: "
            + ", ".join(missing_areas)
        )

    toilet_features = _feature_collection(toilets, "toilets.geojson")
    toilet_banks: list[dict[str, Any]] = []
    for index, feature in enumerate(toilet_features, start=1):
        geometry = feature.get("geometry") if isinstance(feature, dict) else None
        properties = feature.get("properties") if isinstance(feature, dict) else None
        if not isinstance(geometry, dict) or geometry.get("type") != "Polygon":
            raise ValueError(f"toilets.geojson: feature {index} is not a Polygon")
        coordinates = geometry.get("coordinates")
        if not isinstance(coordinates, list) or not coordinates:
            raise ValueError(f"toilets.geojson: feature {index} has no rings")
        rings: list[list[list[float]]] = []
        for ring in coordinates:
            if not isinstance(ring, list):
                raise ValueError(f"toilets.geojson: feature {index} has an invalid ring")
            rings.append([[lng, lat] for lng, lat in (
                _coordinate(pair, "toilets.geojson") for pair in ring
            )])
        centroid_lng, centroid_lat = _ring_centroid(rings[0], "toilets.geojson")
        object_id = properties.get("OBJECTID") if isinstance(properties, dict) else index
        source_class = properties.get("class") if isinstance(properties, dict) else None
        toilet_banks.append({
            "id": f"toilet-{object_id if object_id is not None else index}",
            "name": "Portable toilets",
            "kind": "toilet",
            "layer": "toilets",
            "address": "Official toilet bank",
            "description": "Portable-toilet bank; look for the blue light above it at night.",
            "lat": centroid_lat,
            "lng": centroid_lng,
            "source_class": source_class,
            "rings": rings,
        })

    return {
        "cache_version": GIS_CACHE_VERSION,
        "year": year,
        "source": (
            "https://github.com/burningmantech/innovate-GIS-data/"
            f"tree/master/{year}/GeoJSON"
        ),
        "points": points,
        "areas": areas,
        "toilets": toilet_banks,
    }


def validate_normalized_gis(payload: Any, year: int) -> dict[str, Any]:
    """Validate a cached/browser-facing payload before reuse or embedding."""
    if not isinstance(payload, dict) or payload.get("year") != year:
        raise ValueError(f"normalized GIS payload does not match year {year}")
    if payload.get("cache_version") != GIS_CACHE_VERSION:
        raise ValueError(
            f"normalized GIS cache version must be {GIS_CACHE_VERSION}"
        )
    points = payload.get("points")
    areas = payload.get("areas")
    toilets = payload.get("toilets")
    if not isinstance(points, list) or not points:
        raise ValueError("normalized GIS payload has no curated points")
    if not isinstance(toilets, list) or not toilets:
        raise ValueError("normalized GIS payload has no toilet banks")
    if not isinstance(areas, list) or not areas:
        raise ValueError("normalized GIS payload has no curated areas")
    seen: set[str] = set()
    for item in [*points, *toilets]:
        if not isinstance(item, dict):
            raise ValueError("normalized GIS feature is not an object")
        feature_id = item.get("id")
        if not isinstance(feature_id, str) or not feature_id:
            raise ValueError("normalized GIS feature has no stable id")
        if feature_id in seen:
            raise ValueError(f"duplicate normalized GIS id: {feature_id}")
        seen.add(feature_id)
        _coordinate([item.get("lng"), item.get("lat")], "normalized.json")
        if not isinstance(item.get("kind"), str) or not isinstance(item.get("layer"), str):
            raise ValueError(f"normalized GIS feature {feature_id} lacks presentation metadata")
    for toilet in toilets:
        rings = toilet.get("rings")
        if not isinstance(rings, list) or not rings:
            raise ValueError(f"normalized GIS toilet {toilet['id']} has no rings")
        for ring in rings:
            if not isinstance(ring, list) or len(ring) < 3:
                raise ValueError(f"normalized GIS toilet {toilet['id']} has an invalid ring")
            for pair in ring:
                _coordinate(pair, "normalized.json")
    for area in areas:
        if not isinstance(area, dict):
            raise ValueError("normalized GIS area is not an object")
        area_id = area.get("id")
        if not isinstance(area_id, str) or not area_id:
            raise ValueError("normalized GIS area has no stable id")
        if area_id in seen:
            raise ValueError(f"duplicate normalized GIS id: {area_id}")
        seen.add(area_id)
        if not isinstance(area.get("kind"), str) or not isinstance(area.get("layer"), str):
            raise ValueError(
                f"normalized GIS area {area_id} lacks presentation metadata"
            )
        poi_id = area.get("poi_id")
        if not isinstance(poi_id, str) or poi_id not in seen:
            raise ValueError(
                f"normalized GIS area {area_id} references unknown POI {poi_id!r}"
            )
        polygons = area.get("polygons")
        if not isinstance(polygons, list) or not polygons:
            raise ValueError(f"normalized GIS area {area_id} has no polygons")
        for polygon in polygons:
            if not isinstance(polygon, list) or not polygon:
                raise ValueError(f"normalized GIS area {area_id} has an invalid polygon")
            for ring in polygon:
                if not isinstance(ring, list) or len(ring) < 3:
                    raise ValueError(f"normalized GIS area {area_id} has an invalid ring")
                for pair in ring:
                    _coordinate(pair, "normalized.json")
    return payload


def _atomic_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


class GisFetcher:
    """Fetch, validate, normalize, and cache one annual GIS snapshot."""

    def __init__(self, config: Config):
        self.config = config

    def _download(self, year: int, filename: str) -> bytes:
        url = f"{self.config.gis_base_url.rstrip('/')}/{year}/GeoJSON/{filename}"
        req = urllib.request.Request(url, headers={"User-Agent": self.config.bm_api_user_agent})
        with urllib.request.urlopen(req, timeout=self.config.gis_timeout) as response:
            return response.read()

    def _normalize_and_write(
        self,
        year: int,
        payloads: dict[str, bytes],
    ) -> Path:
        """Normalize raw bytes and atomically replace the derived cache."""
        raw = {
            filename: json.loads(payloads[filename].decode("utf-8"))
            for filename in GIS_FILENAMES
        }
        normalized = normalize_gis(
            year,
            raw["cpns.geojson"],
            raw["plazas.geojson"],
            raw["toilets.geojson"],
        )
        normalized["retrieved_at"] = datetime.now(timezone.utc).isoformat()
        normalized["files"] = {
            filename: {"sha256": hashlib.sha256(payloads[filename]).hexdigest()}
            for filename in sorted(GIS_FILENAMES)
        }
        validate_normalized_gis(normalized, year)
        normalized_path = self.config.gis_payload_file(year)
        _atomic_write(
            normalized_path,
            (json.dumps(normalized, separators=(",", ":")) + "\n").encode("utf-8"),
        )
        return normalized_path

    def _renormalize_cached_raw(self, year: int) -> Path | None:
        """Rebuild derived metadata after curation/schema code changes."""
        out_dir = self.config.gis_year_dir(year)
        paths = {filename: out_dir / filename for filename in GIS_FILENAMES}
        if not all(path.exists() for path in paths.values()):
            return None
        payloads = {filename: path.read_bytes() for filename, path in paths.items()}
        return self._normalize_and_write(year, payloads)

    def fetch_year(self, year: int, *, force: bool = False) -> Path | None:
        out_dir = self.config.gis_year_dir(year)
        normalized_path = self.config.gis_payload_file(year)
        if normalized_path.exists() and not force:
            try:
                cached = json.loads(normalized_path.read_text(encoding="utf-8"))
                validate_normalized_gis(cached, year)
            except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
                try:
                    rebuilt = self._renormalize_cached_raw(year)
                except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError):
                    rebuilt = None
                if rebuilt is not None:
                    print(
                        f"  GIS {year}: regenerated stale normalized cache "
                        f"from raw files ({exc})"
                    )
                    return rebuilt
                print(
                    f"  WARNING: GIS {year} cache is stale/unusable ({exc}); "
                    "attempting a fresh download"
                )
            else:
                print(f"  GIS {year}: using cached {normalized_path}")
                return normalized_path

        out_dir.mkdir(parents=True, exist_ok=True)
        payloads: dict[str, bytes] = {}
        for filename in GIS_FILENAMES:
            try:
                payload = self._download(year, filename)
            except HTTPError as exc:
                if exc.code != 404:
                    raise
                # Annual sources arrive in stages. A missing new-year GIS
                # upstream GIS outage must not block Event Data builds, and a forced
                # refresh must not discard a previously validated same-year
                # snapshot. Other HTTP/network failures still fail loudly.
                if normalized_path.exists():
                    try:
                        cached = json.loads(normalized_path.read_text(encoding="utf-8"))
                        validate_normalized_gis(cached, year)
                    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError):
                        rebuilt = self._renormalize_cached_raw(year)
                        if rebuilt is None:
                            raise
                    print(
                        f"  WARNING: GIS {year} {filename} is not published yet "
                        f"(HTTP 404); retaining cached {normalized_path}"
                    )
                    return normalized_path
                print(
                    f"  WARNING: GIS {year} {filename} is not published yet "
                    "(HTTP 404); building without that year's official overlays"
                )
                return None
            json.loads(payload.decode("utf-8"))
            payloads[filename] = payload
            # Write only after JSON parsing succeeds. os.replace keeps an old
            # usable file intact if the download/process is interrupted.
            _atomic_write(out_dir / filename, payload)

        self._normalize_and_write(year, payloads)
        normalized = json.loads(normalized_path.read_text(encoding="utf-8"))
        print(
            f"  GIS {year}: {len(normalized['points'])} curated POIs · "
            f"{len(normalized['areas'])} curated areas · "
            f"{len(normalized['toilets'])} toilet banks"
        )
        return normalized_path
