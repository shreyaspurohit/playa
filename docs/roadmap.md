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

- Name-assisted favorite migration between directory and API sources, with an
  explicit confirmation step because IDs and annual city plans differ.
- Event-only search and richer event filters.
- Tag co-occurrence or discovery views.
- Year-over-year camp and art comparison without publishing a raw dataset.
- Mutant vehicle support as a separate source/model/UI decision.

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
