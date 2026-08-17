"""Command-line entry points for cached API data and static-site builds."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .builder import SiteBuilder
from .config import Config
from .gis import GisFetcher
from .mapaudit import audit_street_lines_file, format_typescript_candidate
from .sources.api import APISource


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="playa",
                                description="Burning Man API snapshot + site builder")
    sub = p.add_subparsers(dest="cmd", required=True)

    sp_build = sub.add_parser("build", help="build site/index.html")
    sp_build.add_argument(
        "--sources", default=None,
        help=("comma-separated api-YYYY specs. When omitted, derives from "
              "BM_API_YEARS. The BRC_MAP_YEAR snapshot is required and is "
              "always embedded first."),
    )

    sp_all = sub.add_parser(
        "all", help="best-effort GIS refresh followed by an API-cache build",
    )
    sp_all.add_argument(
        "--sources", default=None,
        help="forwarded to `build` (see `build --help`).",
    )

    sp_api = sub.add_parser(
        "api-fetch",
        help="cache an api.burningman.org year (camps + events + art). Requires BM_API_KEY.",
    )
    sp_api.add_argument(
        "--year", type=int, required=True,
        help="event year (e.g., 2024). Must be ≥ 2015 per the API spec.",
    )
    sp_gis = sub.add_parser(
        "gis-fetch",
        help="fetch and normalize official annual BRC GIS map layers",
    )
    sp_gis.add_argument(
        "--year", type=int, action="append", default=None,
        help=("year to fetch; repeat for multiple years. Defaults to the "
              "BRC_MAP_YEAR plus BM_API_YEARS."),
    )
    sp_gis.add_argument(
        "--force", action="store_true",
        help="refresh even when a validated normalized cache exists",
    )
    sp_gis.add_argument(
        "--best-effort", action="store_true",
        help=("isolate failures per year and continue; intended for normal "
              "build orchestration. Without this flag, GIS validation and "
              "network failures remain strict."),
    )
    sp_map_audit = sub.add_parser(
        "map-audit",
        help="audit official street lines and print candidate base-map constants",
    )
    sp_map_audit.add_argument("--year", type=int, required=True)
    sp_map_audit.add_argument(
        "--street-lines", type=Path, required=True,
        help="local official street_lines.geojson path",
    )
    sp_map_audit.add_argument(
        "--center", required=True, metavar="LAT,LNG",
        help="reviewed Golden Spike decimal coordinate",
    )
    sp_map_audit.add_argument(
        "--esplanade-radius-feet", type=float, required=True,
        help="official Measurements-PDF Esplanade centerline radius",
    )
    sp_map_audit.add_argument(
        "--output", type=Path,
        help="optional path for the full JSON audit report",
    )
    sp_map_audit.add_argument(
        "--json", action="store_true",
        help="print the full JSON report instead of the TypeScript candidate",
    )

    food_audit = sub.add_parser(
        "food-audit",
        help="aggregate report of food-classified events (counts only, no records)",
    )
    food_audit.add_argument(
        "--sources", default=None,
        help="comma-separated api-YYYY sources; defaults to BM_API_YEARS",
    )

    return p


# --- individual commands --------------------------------------------------


def cmd_food_audit(config: Config, sources: list[str] | None = None) -> None:
    """Aggregate-only report of event-level food classification.

    Prints counts only — never fetched camp/event text — per the ToS
    stance. Re-run any time to reclassify against updated data.
    """
    from collections import Counter
    resolved = sources or _resolve_sources(None, config)
    builder = SiteBuilder(config, sources=resolved)
    type_counts: Counter[str] = Counter()
    total_events = 0
    food_events = 0
    food_camps = 0
    total_camps = 0
    hours_not_listed = 0
    hours_type_counts: Counter[str] = Counter()
    for spec in resolved:
        camps = builder.load_snapshot_for_source(spec).camps
        source_hours = 0
        for camp in camps:
            total_camps += 1
            camp_has_food = False
            for event in camp.events:
                total_events += 1
                if event.food_tags:
                    food_events += 1
                    camp_has_food = True
                    for t in event.food_tags:
                        type_counts[t] += 1
            if camp_has_food:
                food_camps += 1
            elif camp.food_tags:
                hours_not_listed += 1
                source_hours += 1
                hours_type_counts.update(camp.food_tags)
        print(f"  [{spec}] hours not listed: {source_hours}")
    pct = (100 * food_events // total_events) if total_events else 0
    print(f"food-audit sources: {', '.join(resolved)}")
    print(f"  events: {food_events}/{total_events} food-classified ({pct}%)")
    print(f"  camps with >=1 food event: {food_camps}/{total_camps}")
    print(f"  camps with food in camp text but no food event: {hours_not_listed}")
    print("  food-type distribution (event hits):")
    for name, n in type_counts.most_common():
        print(f"    {name:16s} {n}")
    print("  hours-not-listed type distribution (camp hits):")
    for name, n in hours_type_counts.most_common():
        print(f"    {name:16s} {n}")


def cmd_build(config: Config, sources: list[str] | None = None) -> None:
    SiteBuilder(config, sources=sources).build()


def _gis_years(config: Config, sources: list[str] | None = None) -> list[int]:
    resolved = sources if sources is not None else _resolve_sources(None, config)
    return sorted({int(source[4:]) for source in resolved})


def cmd_gis_fetch(
    config: Config,
    years: list[int] | None = None,
    *,
    force: bool = False,
    best_effort: bool = False,
) -> None:
    """Refresh annual GIS caches.

    The explicit operator command is strict by default so schema/name drift is
    impossible to miss during the annual review. Normal build orchestration
    opts into ``best_effort``: each year is isolated, a valid existing cache is
    left for the builder to use, and a missing cache simply means the base map
    renders without that year's official overlays.
    """
    fetcher = GisFetcher(config)
    for year in sorted(set(years or _gis_years(config))):
        try:
            fetcher.fetch_year(year, force=force)
        except Exception as exc:
            if not best_effort:
                raise
            detail = f"{type(exc).__name__}: {exc}"
            message = (
                f"GIS {year} refresh failed ({detail}); continuing with the "
                "last validated same-year cache, or the base map if absent."
            )
            if os.environ.get("GITHUB_ACTIONS", "").lower() == "true":
                # Make an optional-subsystem failure visible on the workflow
                # summary without turning the build/deploy job red. Escape
                # workflow-command metacharacters in upstream error text.
                annotation = (message.replace("%", "%25")
                               .replace("\r", "%0D")
                               .replace("\n", "%0A"))
                print(f"::warning title=GIS {year} refresh skipped::{annotation}",
                      file=sys.stderr)
            else:
                print(f"  WARNING: {message}", file=sys.stderr)


def cmd_map_audit(
    *,
    year: int,
    street_lines: Path,
    center: str,
    esplanade_radius_feet: float,
    output: Path | None = None,
    as_json: bool = False,
) -> None:
    """Audit official street geometry without mutating runtime map data."""
    try:
        lat_text, lng_text = (piece.strip() for piece in center.split(",", 1))
        center_lat, center_lng = float(lat_text), float(lng_text)
    except (ValueError, TypeError) as exc:
        raise ValueError("--center must be LAT,LNG in decimal degrees") from exc
    report = audit_street_lines_file(
        year=year,
        path=street_lines,
        center_lat=center_lat,
        center_lng=center_lng,
        esplanade_radius_feet=esplanade_radius_feet,
    )
    encoded = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if output is not None:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(encoded, encoding="utf-8")
        print(f"Map audit JSON: {output}", file=sys.stderr)
    if as_json:
        print(encoded, end="")
        return
    schema = report["schema"]
    calibration = report["calibration"]
    print(
        f"Map audit {year}: {schema['feature_count']} LineStrings · "
        f"{len(report['core_annular_streets'])} core rings · "
        f"{len(report['radial_streets'])} radials"
    )
    print(
        "Schema: " + ", ".join(schema["property_keys"])
        + f" · SHA-256 {report['source']['sha256']}"
    )
    print(
        f"Calibration: {calibration['esplanade_source_name']} "
        f"{calibration['observed_radius_feet']}' observed → "
        f"{calibration['official_radius_feet']}' official "
        f"(offset {calibration['offset_feet']:+.1f}')"
    )
    print(
        "Source annular order: "
        + " → ".join(
            entry["source_name"] for entry in report["core_annular_streets"]
        )
    )
    for warning in report["warnings"]:
        print(f"WARNING: {warning}", file=sys.stderr)
    print("\nCandidate fields for BrcMapData (review before applying):")
    print(format_typescript_candidate(report))


def cmd_all(config: Config, sources: list[str] | None = None) -> None:
    """Refresh optional GIS overlays and build only from cached API data."""
    print("==> Refreshing official GIS map layers")
    cmd_gis_fetch(
        config, _gis_years(config, sources), force=False, best_effort=True,
    )
    print("==> Building site")
    cmd_build(config, sources=sources)
    print("==> Done")


def cmd_api_fetch(config: Config, year: int) -> None:
    """Cache one year of API camps, events, and art.

    Three bulk API calls, persisted as a single JSON file at
    `data/api/<year>.json`. `playa build --sources api-<year>` then
    reads it. Re-run any time to refresh.
    """
    APISource(year=year).fetch_and_cache(config)


def _resolve_sources(arg: str | None, config: Config) -> list[str]:
    """Resolve API snapshots, enforcing current-year-first ordering."""
    if arg is not None and arg.strip():
        raw_specs = [s.strip() for s in arg.split(",") if s.strip()]
        years: set[int] = set()
        for spec in raw_specs:
            if not (spec.startswith("api-") and len(spec) == 8 and spec[4:].isdigit()):
                raise ValueError(
                    f"invalid source {spec!r}; only api-YYYY sources are supported",
                )
            year = int(spec[4:])
            if year < config.bm_api_year_min:
                raise ValueError(f"API source year {year} is below {config.bm_api_year_min}")
            years.add(year)
    else:
        years = set(config.parsed_api_years())
        if not years:
            raise ValueError(
                "no API sources configured; pass --sources api-YYYY or set BM_API_YEARS",
            )
    if config.brc_map_year not in years:
        raise ValueError(
            f"configured sources must include api-{config.brc_map_year} "
            "because it is the BRC_MAP_YEAR snapshot",
        )
    ordered = [config.brc_map_year]
    ordered.extend(sorted(years - {config.brc_map_year}, reverse=True))
    return [f"api-{year}" for year in ordered]


# --- entry point ----------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    config = Config.from_env()

    if args.cmd == "build":             cmd_build(config, _resolve_sources(args.sources, config))
    elif args.cmd == "all":             cmd_all(config, _resolve_sources(args.sources, config))
    elif args.cmd == "api-fetch":       cmd_api_fetch(config, args.year)
    elif args.cmd == "gis-fetch":       cmd_gis_fetch(
        config, args.year, force=args.force, best_effort=args.best_effort,
    )
    elif args.cmd == "map-audit":       cmd_map_audit(
        year=args.year,
        street_lines=args.street_lines,
        center=args.center,
        esplanade_radius_feet=args.esplanade_radius_feet,
        output=args.output,
        as_json=args.json,
    )
    elif args.cmd == "food-audit":      cmd_food_audit(config, _resolve_sources(args.sources, config))
    return 0
