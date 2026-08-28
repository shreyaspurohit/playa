---
title: Roadmap
date: 2026-08-27
status: current
---

# Roadmap

Ideas, not commitments. Confirm terms and current implementation before
starting any item.

## Data and operations

- **Post-2026-event workflow defense-in-depth.** After the live-event change
  freeze, add a workflow-level preflight requiring `SITE_TIERS` or
  `SITE_PASSWORD` and update the stale build-step comment that says blank
  secrets produce plaintext. The builder already fails closed unless the
  local-only `ALLOW_PLAINTEXT_BUILD=1` opt-in is explicit, so this is redundant
  operator feedback rather than a current production dependency.
- Extend the annual `map-audit` report with an optional prior-year comparison
  if schema/count review becomes cumbersome. The current tool already derives
  candidate street radii and radial ranges from official GeoJSON without
  changing runtime builds or source files.
- Add an operator view or build report that compares source counts and schema
  drift before deployment.
- Consider more frequent refreshes for the current API year while keeping past
  years immutable and cached.
- Add a tested cache-key rotation procedure that does not require refetching
  data unnecessarily.

## Product

- **Year dropdown (multi-year browsing) — revisit at 2027 prep.** Embed
  multiple `api-YYYY` payloads (already done: 2025 + 2026) and let users pick
  the year. Design it to key off `BRC_MAP_YEAR` as the default "current" year
  with older embedded years as history, so the annual rollover
  **auto-relegates**: bumping `BRC_MAP_YEAR` and adding the new year to
  `BM_API_YEARS` moves the prior year into the dropdown with **no code change**.
  Buildable/testable now, but defer the build to 2027 prep (a year-early UI
  bitrots unused and the real rollover can't be validated until 2027 data
  flows). S3 `archive.py` historical fetch (2015–2025) and year-over-year
  diffing are optional extensions on top.
- **`/update-map` GeoJSON migration (optional, do when convenient).** Parse the
  official GeoJSON to auto-derive the annual map constants instead of the
  `/update-map` hand-copy (assisted today by `map-audit`). Pure dev-ergonomics,
  no user-facing change — worth doing to have the code ready for the next
  annual refresh, but not urgent.
- **Music tab (artist / DJ discovery).** A dedicated tab for music events with
  filters (genre, artist, day/time, camp). Start API-only: music events already
  live inside camp `occurrence_set`s, so classify them with a music taxonomy
  extending `tagger.py` (the food-tag pattern) rather than adding a source.
  Artist detail the API lacks (bios, set times, lineups) would need an external
  source — treat that as a separate, later enrichment: confirm the BM API terms
  allow mixing external data, keep source event text un-rewritten and disclosed,
  keep `BM_API_KEY` server-side, and embed any external data at build time so
  the PWA stays offline. Defer the internet-sourced part until a licensed,
  attributable, offline-embeddable data source is chosen.
- **Parties linked to art.** Surface parties/events associated with an art piece
  (e.g. a sound-art installation's nightly set) on the art card. The current API
  models events as `hosted_by_camp` and art separately, with no direct art↔event
  link — so this needs a relationship strategy (shared location proximity, or
  curated linking) before it can render. Honor art location masking until
  `ART_LOCATION_RELEASE_AT`.
- **Burner packing list tab.** A year-owned, offline checklist (categories,
  check-off, custom items). Holds no Event Data, so it follows the journal model
  — local-first `localStorage`, optional App-folder Dropbox sync, independent of
  record-source availability (see [20-journal.md](20-journal.md),
  [16-cloud-sync.md](16-cloud-sync.md)). The most self-contained of these and a
  good next standalone feature.
- **Camp location mini-map in the camp card.** Expand a camp card to reveal its
  playa location on a small per-year BRC map. Reuse `brcForSource` geometry plus
  `addressToLatLng` (already used for the Schedule "near me" distance). Must
  honor current-year camp location masking (locked until
  `CAMP_LOCATION_RELEASE_AT`; only trusted god-mode bypasses) and the
  exact-year-geometry rule from [10-map-system.md](10-map-system.md) — never
  borrow another year's coordinates. The expand animation is presentation; keep
  it accessible and offline.

## Won't do (decided 2026)

Explicitly declined, not deferred backlog. Do not implement without a new
owner decision reversing these.

- **Event-only search and richer event filters** — the unified search already
  covers event name/description/time; a separate mode isn't wanted.
- **Tag co-occurrence / discovery views** — the tag cloud + AND-filter is
  sufficient.
- **Map overlays: Gate Road, DMZ / Sound zones, D-Lot** — deliberately dropped
  (see [10-map-system.md](10-map-system.md)).
- **App-side content encryption of the Dropbox sync/journal files** — the data
  lives in the user's own encrypted Dropbox account; keep it plainly readable
  (see [16-cloud-sync.md](16-cloud-sync.md) D11 and [20-journal.md](20-journal.md)).
- **Mid-session tier-up password affordance** — all real users are spirit-mode;
  higher tiers exist only for the operator to test and compare.
- **Mutant vehicle source / catalog** — art cars move and have no fixed
  location; they're a discover-in-the-moment thing you can't plan or map.

## Scaling boundaries

- Split source payloads into same-origin lazy-loaded files if embedded history
  makes `index.html` too large. Preserve offline caching and encryption.
- Consider per-user access such as Cloudflare Access only if shared tier
  passwords become operationally inadequate.

## Recently completed foundations

- Annual BRC base-grid transcription is assisted by the read-only
  `python -m playa map-audit` command. It validates and fingerprints official
  `street_lines.geojson`, reports schema/count/bounds, excludes non-grid roads,
  and derives reviewed TypeScript candidates. Golden Spike, orientation,
  themed names, fence, and final source edits remain human-reviewed by design.
