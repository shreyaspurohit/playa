---
title: Site UI Reference
date: 2026-08-06
status: current
---

# Site UI Reference

## Data and access

The site supports plaintext gzip/base64, legacy single-password encryption,
and multi-tier envelope encryption. Camps and art are parallel per-source
payloads. In envelope mode the source picker contains only sources unlocked by
the password or burn key.

Current-year API locations are client-masked before the configured burn start,
unless an internal trusted wrapper unlocked. When the cutoff passes, the client
can prompt a refresh so data is re-ingested.

## Main surfaces

- **Camps** — search, AND-combined tag filters, website/favorite filters,
  cards, events, and home-camp selection.
- **Art** — parallel search/tag/favorite surface with artist and program data.
- **Schedule** — starred events organized by day with Now/Near Me filters.
- **Map** — year-specific BRC geometry, starred camp/art pins, GPS, friend
  overlays, home camp, and meet spots.
- **Share/import/export** — fragment links and validated JSON snapshots, scoped
  to a source.

Five themes (paper, daylight, dusk, night, eclipse) are applied before body
paint and persisted locally. The PWA shell and embedded data work offline after
one successful load.

## Source-aware notices

The gate describes the app generically because the password determines which
source becomes available.

Footer and About behavior:

- Always show the exact Burning Man Project no-affiliation notice.
- Always label app-generated tags and normalized event times.
- Show directory attribution, directory verification links, directory data
  provenance, and camp-owner directory takedown wording only for `directory`.
- Never render directory-specific wording for an API-only unlock, including the
  first frame after a stale persisted selection.

The About modal also explains local storage, GPS, sharing, refresh, export,
import, and data clearing. Its info button pulses on early visits.

## Search and controls

Search scans normalized haystacks and highlights literal matches. Tag chips
combine with AND semantics. `/` focuses search and Escape clears it when no
modal is consuming the key. Rendering is capped for responsiveness.

## Code references

- `client/src/components/App.tsx`
- `client/src/components/Footer.tsx`
- `client/src/components/InfoModal.tsx`
- `client/src/components/Header.tsx`
- `client/src/components/Toolbar.tsx`
- `client/src/components/MapView.tsx`
- `backend/src/playa/templates/site.html`
