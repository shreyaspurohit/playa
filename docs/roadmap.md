---
title: Roadmap
date: 2026-08-06
status: current
---

# Roadmap

Ideas, not commitments. Confirm terms and current implementation before
starting any item.

## Data and operations

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
- **directory↔API favorite migration** — users don't switch sources; the source
  switch is operator-only (testing / viewing history), so favorites need not
  carry across id spaces.
- **Mid-session tier-up password affordance** — all real users are spirit-mode;
  higher tiers exist only for the operator to test and compare.
- **Mutant vehicle source / catalog** — art cars move and have no fixed
  location; they're a discover-in-the-moment thing you can't plan or map.
- **Per-year-source denylists** — global id takedown is the default; build a
  per-source/year variant *only if* a specific year's takedown ever requires it.

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
