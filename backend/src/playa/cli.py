"""argparse-based CLI. Invoke via `python -m playa <subcommand>`.

Subcommands:
    fetch <page>          Pull a single listing page + its detail pages.
    fetch-all             Pull every page in parallel. Cleans data/pages/ first.
    fetch-art <page>      Pull a single /artwork/ listing page + details.
    fetch-art-all         Pull every artwork page in parallel.
                          Cleans data/art_pages/ first.
    meta                  Write data/meta.json from the current data/pages/.
    merge                 Write data/camps.csv + data/art.csv (tags blank).
    tag                   Re-tag + write data/camps_tagged.csv +
                          data/art_tagged.csv.
    build                 Build site/index.html. Defaults to directory only;
                          `--sources directory,api-2024,api-2025` embeds more.
    all                   fetch-all + fetch-art-all + meta + merge + tag +
                          build  (nightly pipeline).
    api-fetch --year YYYY Hit api.burningman.org and cache the response
                          (camps + events + art) at data/api/<year>.json.
                          Requires BM_API_KEY in env.
"""
from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

from .builder import SiteBuilder
from .config import Config
from .fetcher import Fetcher
from .merger import merge_csv, write_tagged_csv
from .meta import write_meta
from .sources.api import APISource
from .tagger import Tagger


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="playa",
                                description="Burning Man camp directory fetcher + site builder")
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("fetch", help="pull one listing page + its detail pages")
    sp.add_argument("page", type=int, help="page number (1-based)")

    sub.add_parser("fetch-all", help="pull every listing page in parallel")

    sp_fa = sub.add_parser("fetch-art", help="pull one /artwork/ listing page + details")
    sp_fa.add_argument("page", type=int, help="page number (1-based)")

    sub.add_parser("fetch-art-all", help="pull every /artwork/ page in parallel")

    sub.add_parser("meta",      help="write data/meta.json")
    sub.add_parser("merge",     help="write data/camps.csv + data/art.csv")
    sub.add_parser("tag",       help="re-tag + write data/camps_tagged.csv + data/art_tagged.csv")

    sp_build = sub.add_parser("build", help="build site/index.html")
    sp_build.add_argument(
        "--sources", default=None,
        help=("comma-separated source specs. Each is `directory` or "
              "`api-YYYY`. First entry is the default selection. "
              "When omitted, derives from BM_API_YEARS env "
              "(e.g., `BM_API_YEARS=2024,2025` → "
              "directory,api-2024,api-2025). Falls back to "
              "`directory` only."),
    )

    sp_all = sub.add_parser(
        "all", help="full pipeline: fetch-all + meta + merge + tag + build",
    )
    sp_all.add_argument(
        "--sources", default=None,
        help="forwarded to `build` (see `build --help`).",
    )

    sp_api = sub.add_parser(
        "api-fetch",
        help="cache an api.burningman.org year (camps + events). Requires BM_API_KEY.",
    )
    sp_api.add_argument(
        "--year", type=int, required=True,
        help="event year (e.g., 2024). Must be ≥ 2015 per the API spec.",
    )
    return p


# --- individual commands --------------------------------------------------

def cmd_fetch(config: Config, page: int) -> None:
    Fetcher(config).fetch_page_to_file(page)


def cmd_fetch_all(config: Config) -> None:
    """Clean data/pages/ and data/logs/, then pull every page in parallel.

    Uses threads because the workload is I/O-bound (HTTP fetches). Each
    thread gets its own Fetcher so there's no shared mutable state.
    """
    config.pages_dir.mkdir(parents=True, exist_ok=True)
    config.logs_dir.mkdir(parents=True, exist_ok=True)
    for f in config.pages_dir.glob("page_*.json"):
        f.unlink()
    for f in config.logs_dir.glob("page_*.log"):
        f.unlink()

    fetcher = Fetcher(config)
    pages = list(range(1, config.pages + 1))
    print(f"==> Fetching {len(pages)} pages (parallelism {config.parallel})")

    errors: list[tuple[int, Exception]] = []
    with ThreadPoolExecutor(max_workers=config.parallel) as pool:
        futures = {pool.submit(fetcher.fetch_page_to_file, p): p for p in pages}
        for fut in as_completed(futures):
            page = futures[fut]
            try:
                fut.result()
                print(f"  done page {page}")
            except Exception as e:
                errors.append((page, e))
                print(f"  FAILED page {page}: {e}", file=sys.stderr)

    if errors:
        raise SystemExit(f"{len(errors)} page(s) failed: {[p for p, _ in errors]}")


def cmd_fetch_art(config: Config, page: int) -> None:
    Fetcher(config).fetch_art_page_to_file(page)


def cmd_fetch_art_all(config: Config) -> None:
    """Clean data/art_pages/ and pull every /artwork/ listing page.

    Mirrors `cmd_fetch_all` for the artwork tree. The directory's
    artwork pagination is much smaller than camps (typically <10
    pages vs camps' 30) but reuses the same pagination contract.
    Page count is read from the same `Config.pages` knob — overrides
    via PAGES env var if the artwork count diverges.
    """
    config.art_pages_dir.mkdir(parents=True, exist_ok=True)
    for f in config.art_pages_dir.glob("art_*.json"):
        f.unlink()

    fetcher = Fetcher(config)
    pages = list(range(1, config.pages + 1))
    print(f"==> Fetching {len(pages)} artwork pages "
          f"(parallelism {config.parallel})")

    errors: list[tuple[int, Exception]] = []
    with ThreadPoolExecutor(max_workers=config.parallel) as pool:
        futures = {pool.submit(fetcher.fetch_art_page_to_file, p): p
                   for p in pages}
        for fut in as_completed(futures):
            page = futures[fut]
            try:
                fut.result()
                print(f"  done art page {page}")
            except Exception as e:
                errors.append((page, e))
                print(f"  FAILED art page {page}: {e}", file=sys.stderr)

    if errors:
        # Don't abort — the directory's artwork count varies
        # year-to-year, so over-fetching by a page or two is normal
        # and shouldn't fail the build. Camps' fetch-all is strict
        # because it's the primary source; art is secondary.
        print(f"  ({len(errors)} art page(s) skipped: "
              f"{[p for p, _ in errors]})", file=sys.stderr)


def cmd_meta(config: Config) -> None:
    write_meta(config)


def cmd_merge(config: Config) -> None:
    merge_csv(config)


def cmd_tag(config: Config) -> None:
    """Re-tag + write data/camps_tagged.csv AND data/art_tagged.csv.

    Reuses the builder's load path to keep logic identical: same dedupe,
    same denylist, same tag text. Art tagging mirrors camps but uses
    the art haystack (name + description + artist + category + program).
    """
    builder = SiteBuilder(config)
    camps = builder.load_camps()
    rows = [
        {
            "camp_name":   c.name,
            "location":    c.location,
            "description": c.description,
            "website":     c.website,
            "tags":        ";".join(c.tags),
        }
        for c in camps
    ]
    write_tagged_csv(config, rows)

    # Quick stderr summary — mirrors the old tag.py output so cron diffs stay readable.
    from collections import Counter
    c = Counter()
    untagged = 0
    for row in rows:
        if row["tags"]:
            for t in row["tags"].split(";"):
                c[t] += 1
        else:
            untagged += 1
    print(f"  ({untagged} untagged)")
    print("top 30 tags:")
    for name, n in c.most_common(30):
        print(f"  {name:20s} {n}")

    # Art parallel: tag + write a separate CSV, separate top-30 dump.
    art = builder.load_art_for_source("directory")
    art_rows = [
        {
            "art_name":    a.name,
            "location":    a.location,
            "description": a.description,
            "artist":      a.artist,
            "category":    a.category,
            "tags":        ";".join(a.tags),
        }
        for a in art
    ]
    from .merger import write_art_tagged_csv
    write_art_tagged_csv(config, art_rows)
    a_counter = Counter()
    a_untagged = 0
    for row in art_rows:
        if row["tags"]:
            for t in row["tags"].split(";"):
                a_counter[t] += 1
        else:
            a_untagged += 1
    print(f"  art: ({a_untagged} untagged of {len(art_rows)})")
    if a_counter:
        print("art top 30 tags:")
        for name, n in a_counter.most_common(30):
            print(f"  {name:20s} {n}")


def cmd_build(config: Config, sources: list[str] | None = None) -> None:
    SiteBuilder(config, sources=sources).build()


def cmd_all(config: Config, sources: list[str] | None = None) -> None:
    cmd_fetch_all(config)
    print("==> Fetching art")
    cmd_fetch_art_all(config)
    print("==> Writing meta")
    cmd_meta(config)
    print("==> Merging to CSV")
    cmd_merge(config)
    print("==> Tagging")
    cmd_tag(config)
    print("==> Building site")
    cmd_build(config, sources=sources)
    print("==> Done")


def cmd_api_fetch(config: Config, year: int) -> None:
    """Cache one year of api.burningman.org camps+events.

    Two API calls (one per kind), persisted as a single JSON file at
    `data/api/<year>.json`. `playa build --sources api-<year>` then
    reads it. Re-run any time to refresh.
    """
    APISource(year=year).fetch_and_cache(config)


def _resolve_sources(arg: str | None, config: Config) -> list[str]:
    """Argument > BM_API_YEARS > default ['directory'].

    Argument: comma-separated string ("directory,api-2024,api-2025").
    Env: BM_API_YEARS=2024,2025 → ['directory', 'api-2024', 'api-2025'].
    Default: ['directory'].
    """
    if arg is not None and arg.strip():
        return [s.strip() for s in arg.split(",") if s.strip()]
    years = config.parsed_api_years()
    if years:
        return ["directory"] + [f"api-{y}" for y in years]
    return ["directory"]


# --- entry point ----------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    config = Config.from_env()

    if args.cmd == "fetch":             cmd_fetch(config, args.page)
    elif args.cmd == "fetch-all":       cmd_fetch_all(config)
    elif args.cmd == "fetch-art":       cmd_fetch_art(config, args.page)
    elif args.cmd == "fetch-art-all":   cmd_fetch_art_all(config)
    elif args.cmd == "meta":            cmd_meta(config)
    elif args.cmd == "merge":           cmd_merge(config)
    elif args.cmd == "tag":             cmd_tag(config)
    elif args.cmd == "build":           cmd_build(config, _resolve_sources(args.sources, config))
    elif args.cmd == "all":             cmd_all(config, _resolve_sources(args.sources, config))
    elif args.cmd == "api-fetch":       cmd_api_fetch(config, args.year)
    return 0
