# Build Pipeline

**Status:** Accepted
**Last updated:** 2026-08-16

## Overview

The build transforms cached annual API snapshots and optional annual GIS data
into a static, encrypted-capable PWA. The normal build path performs no Event
Data network request.

## Decisions

- `playa api-fetch --year YYYY` is an explicit operator action.
- `playa all` means best-effort GIS refresh followed by a cached API-only build.
- Source resolution is strict and current-year-first.
- A source cache is decrypted and parsed once into camps, events, art, and
  `fetched_at`.
- Classification happens in memory; no intermediate CSV or freshness file is
  produced.
- Visible freshness and application version are separate values.
- `MIN_CAMPS` validates the current-year primary snapshot.
- Ask embeddings are generated from API records only and use a cutover-specific
  cache namespace.

## Stages

1. Bundle the Preact application and lazy semantic runtime.
2. Resolve explicit `--sources` or `BM_API_YEARS`; require `BRC_MAP_YEAR`.
3. Best-effort refresh official GIS layers when running `all`.
4. Load every configured annual API cache; fail if any is missing or malformed.
5. Normalize records and add tags, time formatting, and food classifications.
6. Enforce the current-year `MIN_CAMPS` safety rail.
7. Derive `Updated` from the primary cache's `fetched_at`; derive `vYYYY.MM.DD.HHMM`
   from build time.
8. Gzip and embed or envelope-encrypt each source, including tier wrappers.
9. Generate semantic vectors when enabled.
10. Generate `site/index.html`, `privacy.html`, `sw.js`, and `version.txt`.

## Commands

```bash
make fetch-api YEAR=2026  # explicit API refresh
make rebuild              # cached snapshots -> full generated site
make build                # same API-only site assembly
python3 -m playa all      # optional GIS refresh + cached build
```

`BM_API_YEARS` is required unless `--sources` is supplied. A production shape is
`BM_API_YEARS=2025,2026 BRC_MAP_YEAR=2026`; resolution becomes
`api-2026,api-2025`.

## Failure modes and trade-offs

- Missing API cache, invalid source, absent current year, invalid tier source,
  or too-small primary source: fail loud.
- GIS download/schema failure: warn and build without that optional overlay.
- Semantic generation failure: fail a production embeddings-enabled build.
- A push-triggered or ordinary manual cache miss never becomes an implicit
  network refresh.

## Code references

- `backend/src/playa/cli.py`
- `backend/src/playa/builder.py`
- `backend/src/playa/sources/api.py`
- `client/esbuild.config.mjs`
- `client/scripts/embed.mjs`
- `Makefile`
