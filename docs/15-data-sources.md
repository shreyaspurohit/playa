# Annual API Snapshot Architecture

**Status:** Accepted
**Last updated:** 2026-08-16

## Overview

Every data source is an immutable annual API snapshot named `api-YYYY`. A build
may contain several years, but `api-BRC_MAP_YEAR` is always first and is the
primary source. User state is scoped by source so annual identifiers never
collide. The app never fetches Event Data at runtime.

## Decisions

### D1 — Source identifiers are strict

The registry accepts only `api-YYYY`. Builds require either explicit
`--sources` or nonempty `BM_API_YEARS`; the configured set must include
`BRC_MAP_YEAR`. Resolution order is current year first, then remaining years
newest first. An invalid source or missing configured snapshot is fatal.

### D2 — One normalized source snapshot

`APISource.load_snapshot()` decrypts and parses one cache file once and returns
`SourceSnapshot(camps, art, fetched_at)`. Events are nested under camps. Camp and
art models contain no generated record URL.

### D3 — Annual time and map identity

API source names determine their own record/map year. The separate
`bm-brc-map-year` metadata value supplies current burn and journal defaults; it
does not rewrite the identity of an older source. Geometry is exact-year only:
missing geometry disables the affected map capability rather than borrowing a
different year.

### D4 — User state is source-scoped

Favorites, event favorites, art favorites, home camp, meet spots, hidden days,
and imported friends use `<base-key>/<source>`. `api-2026` keys are preserved
unchanged across this cutover. Unsupported historical namespaces receive no ID
migration. A stale selected source falls back to the first unlocked API source.

### D5 — Shares and snapshots identify their source

New share fragments always encode `api-YYYY`. The decoder accepts only tagged
API shares and rejects source-less links. Export/import helpers require an
explicit source argument so IDs cannot silently land in the wrong annual
namespace.

### D6 — One embedded payload per source

The builder emits source-specific camps/events and art script tags plus
`bm-sources` in resolved order. Plaintext local builds use compressed payloads.
Encrypted builds use one per-source cipher and one key wrapper for every tier
authorized for that source.

### D7 — Encrypted GitHub Release cache

`data/api/YYYY.json` is never committed. Manual `make fetch-api YEAR=YYYY` or a
manual Actions dispatch refreshes it with the keyed API, optionally encrypts it
with `BM_CACHE_PASSWORD` (falling back to `SITE_PASSWORD`), and stores the
encrypted asset on Release `data-api-YYYY`. Push-triggered and ordinary manual
builds only download these assets; cache misses fail and never trigger an API
fetch.

### D8 — Current-year location embargo

`CAMP_LOCATION_RELEASE_AT` and `ART_LOCATION_RELEASE_AT` independently gate
current-year fields. Spirit and demigod users remain masked before release.
Trusted `god-mode` wrappers may bypass the mask for internal validation. Past
years pass through; future years and malformed policy fail closed.

### D9 — Local record suppression remains source-specific

Operator-only API ID suppression files, when present locally, are source-type
specific and contain IDs only. They are not a substitute for the termination
procedure, which destroys complete Event Data copies.

### D10 — Named tier manifests

`SITE_TIERS` is generic source-to-password authorization:

- `god-mode`: all configured annual sources, trusted embargo bypass.
- `demigod-mode`: all configured annual sources, normal embargo.
- `spirit-mode`: only `api-BRC_MAP_YEAR`, normal embargo.

Names are required. Any tier reference to an unregistered or unloaded source
fails the build. `BURN_OPEN` may publish only the spirit wrapper in
`site/burn-key.json`; other tiers remain gated.

### D11 — GIS is annual and optional

Official GIS normalization is keyed by year. `all` performs a best-effort GIS
refresh, then builds from cached API snapshots. GIS failure may remove optional
overlays but cannot cause fallback to a different year.

### D12 — Compress before encrypt

JSON is gzip-compressed before encryption and decompressed after browser
decryption. This keeps the deployed payload smaller without changing the trust
model.

### D13 — Site unlock and burn calendar are separate

`SITE_UNLOCK_START` / `SITE_UNLOCK_END` control password-free spirit access as
a half-open Playa-date interval: START is the first open date and END is the
first re-locked date. A lightweight daily GitHub Actions trigger reads those
repository variables and runs the full test/build/deploy path only on either
boundary; local `.env` values cannot affect it. `BURN_WINDOW_OPEN_FROM` /
`BURN_WINDOW_OPEN_TO` independently control event-calendar dates. Location
disclosure has its own timestamps. A manual `BURN_OPEN` dispatch input wins
over the dated unlock window.

The burn-window variables describe the `BRC_MAP_YEAR` window and must match its
explicit, officially reviewed entry in `backend/src/playa/schedule.py`.
Schedule and Food receive the separate reviewed window emitted for each
embedded `api-YYYY`; they never derive a historical window from the current
year or a holiday. Missing annual entries fail the build. Every window stays
inside its source year, and occurrence timestamps must have both start and end
in that year. Dates are never rewritten across annual source boundaries.

### D14 — Art is part of the same snapshot

Art is loaded, encrypted, tiered, searched, shared, and embargoed alongside
camps/events. It is not fetched or decrypted through a second source adapter.

## Build and runtime flow

1. Resolve and validate annual sources.
2. Load every configured encrypted snapshot; fail on any missing source.
3. Validate `MIN_CAMPS` against the current-year primary snapshot.
4. Normalize/tag camps, events, and art.
5. Use the primary cache's `fetched_at` for visible freshness.
6. Generate a separate build-time shell version.
7. Encrypt/embed source payloads and optional tier wrappers.
8. Copy the lazy semantic runtime and generate source-tagged embeddings.
9. Generate the service worker and privacy page.

At runtime, the gate unlocks source keys, the selected payload is decrypted and
masked according to trust and release policy, and all local/Dropbox state is
read from that source's scoped keys.

## Failure modes and trade-offs

- A missed snapshot intentionally blocks the build.
- The API cache can be stale; its `fetched_at` is shown to users.
- Annual IDs are unrelated across sources; there is no cross-year migration.
- An offline device can retain an old encrypted shell until it reconnects. The
  next worker activation deletes old shell/vector caches while preserving the
  source-independent model cache.

## Code references

- `backend/src/playa/sources/__init__.py`
- `backend/src/playa/sources/api.py`
- `backend/src/playa/builder.py`
- `backend/src/playa/cli.py`
- `client/src/hooks/useSource.ts`
- `client/src/data.ts`
- `client/src/utils/share.ts`
- `client/src/utils/exportImport.ts`
- `.github/workflows/refresh.yml`
