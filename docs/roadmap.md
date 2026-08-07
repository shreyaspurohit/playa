---
title: Roadmap
date: 2026-08-06
status: current
---

# Roadmap

Ideas, not commitments. Confirm terms and current implementation before
starting any item.

## Data and operations

- Automate annual BRC map-data updates from official GeoJSON instead of manual
  coordinate transcription.
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
