---
title: Site UI Reference
date: 2026-08-06
updated: 2026-08-10
status: current
---

# Site UI Reference

## Data and access

The site supports plaintext gzip/base64, legacy single-password encryption,
and multi-tier envelope encryption. Camps and art are parallel per-source
payloads. In envelope mode the source picker contains only sources unlocked by
the password or burn key.

Current-year API locations are client-masked until their independently
configured camp/art release timestamps, unless an internal trusted wrapper is
unlocked. The client evaluates those timestamps directly; no rebuild or data
re-ingestion is required when a release instant passes.

## Main surfaces

- **Camps** — search, AND-combined tag filters, website/favorite filters,
  cards, events, and home-camp selection.
- **Art** — parallel search/tag/favorite surface with artist and program data.
- **Schedule** — starred events organized by day with Now/Near Me filters.
- **Food** — food-classified camp events organized by live availability, with
  dish and dietary filters, search, event stars, upcoming picks, inline
  details, refresh, and Near Me controls. Hours-not-listed uses precise food
  matches from camp prose when no food event exists.
- **Map** — year-specific BRC geometry, starred camp/art pins, GPS, friend
  overlays, home camp, and meet spots.
- **Share/import/export** — fragment links and validated JSON snapshots, scoped
  to a source.

Five themes (paper, daylight, dusk, night, eclipse) are applied before body
paint and persisted locally. The PWA shell and embedded data work offline after
one successful load.

The main tabs intentionally omit numeric badges. Schedule/Art counts would mean
saved items while a Food count would mean camps currently serving, so using the
same badge treatment would be misleading.

At phone widths, sustained downward scrolling collapses the global title,
tabs, actions, and banners; reversing direction restores them. Each tab retains
its useful context: Camps/Art search and filters, Food search, Schedule filters,
and the Map control panel. Desktop chrome remains fully visible. See
[ADR 18](../18-mobile-scroll-chrome.md).

Camp cards contain unbroken source URLs/tokens with `overflow-wrap: anywhere`
and `min-width: 0`. Without that boundary, one record can widen the mobile
document and trigger browser auto-fit scaling.

## Source-aware notices

The gate describes the app generically because the password determines which
source becomes available.

Footer and About behavior:

- Always show the exact Burning Man Project no-affiliation notice.
- Always label app-generated tags and normalized event times.
- State that the official API snapshot may be stale or incomplete and direct
  critical verification to current official Burning Man communications.
- Do not render upstream record links on camps, events, art, maps, or schedules.

The top-right menu opens a two-tab information modal. **How to use** covers
Camps/Art discovery, Food availability and reversible Near Me filtering,
Schedule, map/GPS privacy, rendezvous, sharing, mobile scroll-aware chrome,
installation, and offline use. **About & disclaimer** explains local storage,
optional GPS, source transformations, refresh, export/import, and data clearing.
The user-facing modal does not expose developer query parameters; simulated
time/GPS instructions belong only in ADRs and the mobile testing runbook. Its
info item pulses on early visits.

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
