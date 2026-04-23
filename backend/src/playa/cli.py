"""argparse-based CLI. Invoke via `python -m playa <subcommand>`.

Subcommands:
    scrape <page>    Fetch a single listing page + its detail pages.
    scrape-all       Fetch every page in parallel. Cleans data/pages/ first.
    meta             Write data/meta.json from the current data/pages/.
    merge            Write data/camps.csv (tags blank).
    tag              Re-tag + write data/camps_tagged.csv.
    build            Build site/index.html from data/pages/.
    all              scrape-all + meta + merge + tag + build  (nightly pipeline).
"""
from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

from .builder import SiteBuilder
from .config import Config
from .merger import merge_csv, write_tagged_csv
from .meta import write_meta
from .scraper import Scraper
from .tagger import Tagger


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="playa",
                                description="Burning Man camp directory scraper + site builder")
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("scrape", help="fetch one listing page + its detail pages")
    sp.add_argument("page", type=int, help="page number (1-based)")

    sub.add_parser("scrape-all", help="fetch every listing page in parallel")
    sub.add_parser("meta",       help="write data/meta.json")
    sub.add_parser("merge",      help="write data/camps.csv")
    sub.add_parser("tag",        help="re-tag + write data/camps_tagged.csv")
    sub.add_parser("build",      help="build site/index.html")
    sub.add_parser("all",        help="full pipeline: scrape-all + meta + merge + tag + build")
    return p


# --- individual commands --------------------------------------------------

def cmd_scrape(config: Config, page: int) -> None:
    Scraper(config).scrape_page_to_file(page)


def cmd_scrape_all(config: Config) -> None:
    """Clean data/pages/ and data/logs/, then scrape every page in parallel.

    Uses threads because the workload is I/O-bound (HTTP fetches). Each
    thread gets its own Scraper so there's no shared mutable state.
    """
    config.pages_dir.mkdir(parents=True, exist_ok=True)
    config.logs_dir.mkdir(parents=True, exist_ok=True)
    for f in config.pages_dir.glob("page_*.json"):
        f.unlink()
    for f in config.logs_dir.glob("page_*.log"):
        f.unlink()

    scraper = Scraper(config)
    pages = list(range(1, config.pages + 1))
    print(f"==> Scraping {len(pages)} pages (parallelism {config.parallel})")

    errors: list[tuple[int, Exception]] = []
    with ThreadPoolExecutor(max_workers=config.parallel) as pool:
        futures = {pool.submit(scraper.scrape_page_to_file, p): p for p in pages}
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


def cmd_meta(config: Config) -> None:
    write_meta(config)


def cmd_merge(config: Config) -> None:
    merge_csv(config)


def cmd_tag(config: Config) -> None:
    """Re-tag + write data/camps_tagged.csv.

    Reuses the builder's load path to keep logic identical: same dedupe,
    same denylist, same tag text.
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


def cmd_build(config: Config) -> None:
    SiteBuilder(config).build()


def cmd_all(config: Config) -> None:
    cmd_scrape_all(config)
    print("==> Writing meta")
    cmd_meta(config)
    print("==> Merging to CSV")
    cmd_merge(config)
    print("==> Tagging")
    cmd_tag(config)
    print("==> Building site")
    cmd_build(config)
    print("==> Done")


# --- entry point ----------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    config = Config.from_env()

    if args.cmd == "scrape":       cmd_scrape(config, args.page)
    elif args.cmd == "scrape-all": cmd_scrape_all(config)
    elif args.cmd == "meta":       cmd_meta(config)
    elif args.cmd == "merge":      cmd_merge(config)
    elif args.cmd == "tag":        cmd_tag(config)
    elif args.cmd == "build":      cmd_build(config)
    elif args.cmd == "all":        cmd_all(config)
    return 0
