---
title: Architecture Docs Index
date: 2026-04-27
updated: 2026-08-11
status: current
---

# Architecture Docs Index

This folder is the **system-decisions** record for Playa Camps — *why*
each subsystem looks the way it does, what alternatives were considered,
and where the entry-points live in the code.

For day-to-day "how do I X" answers (build, deploy, tag taxonomy
edits), `CLAUDE.md` at the repo root is still the operational manual.
These docs go a level below that — design and trade-offs.

## How to read

Each doc is dated, scoped to one concept, and lays out the same
sections wherever they apply:

1. **Overview** — one-paragraph "what is this".
2. **Decisions** — the choices that shape it, with rationale.
3. **Mechanism** — how it actually works, often with a Mermaid diagram.
4. **Failure modes & trade-offs** — what we don't defend against, what
   could break, what we'd revisit if scale changed.
5. **Code references** — file paths the reader should open next.

## Index

| # | Topic | One-liner |
|---|---|---|
| [01](./01-overview.md) | System overview | The whole pipeline in one page |
| [02](./02-tech-stack.md) | Tech stack & tool choices | Preact, Python stdlib, esbuild, GH Actions — and why |
| [03](./03-build-pipeline.md) | Build pipeline | Fetch → parse → tag → bundle → encrypt → embed → deploy |
| [04](./04-data-encryption.md) | Camp data encryption | PBKDF2 + AES-CBC, openssl ↔ Web Crypto round-trip |
| [05](./05-password-management.md) | Password gate + secure cache | Gate, AES-GCM wrap key in IndexedDB |
| [06](./06-multi-tab-sync.md) | Multi-tab synchronization | `storage` events for state, BroadcastChannel for password |
| [07](./07-offline-pwa.md) | Offline + PWA | Service worker SHELL precache, install prompt |
| [08](./08-versioning-and-release-notes.md) | Versioning & release notes | `vYYYY.MM.DD.HHMM`, `version.txt` polling, `rn:` commits |
| [09](./09-share-and-import.md) | Share links & snapshot import/export | Fragment-based links, JSON file transfer, self-recognition |
| [10](./10-map-system.md) | Map system | SVG BRC grid, GPS, official GIS overlays, zoom/pan, address ↔ lat/lng |
| [11](./11-schedule-system.md) | Schedule system | Event time parsing, calendar columns, filters |
| [12](./12-deployment-and-ci.md) | Deployment & CI | GitHub Actions, Pages, custom domain |
| [13](./13-tos-compliance.md) | ToS compliance | directory.burningman.org + Innovate API stance |
| [14](./14-refresh-cycle.md) | Refresh & force-refresh | What each path does, the SW interactions, the bug we fixed |
| [15](./15-data-sources.md) | Multi-source data architecture | Directory + `api.burningman.org`, per-source state, normalization |
| [16](./16-cloud-sync.md) | Cloud sync (draft) | Opt-in, provider-agnostic sync of user state; Dropbox default, LWW soft-delete |
| [17](./17-food-tab.md) | Food tab | Food-only classification, live availability, search, filters, stars, and Near Me |
| [18](./18-mobile-scroll-chrome.md) | Mobile scroll-aware chrome | Auto-hide global chrome while retaining each tab's task-critical controls |
| [19](./19-food-classification-audit.md) | Local Food classification audit | Private two-model review of Hours-not-listed false positives, with ID-only proposals |
| (op) | [Revocation runbook](./revocation-plan.md) | Step-by-step if a takedown lands |
| (ref) | [Client architecture](./dev/client-architecture.md) | Compact Preact implementation reference; CLAUDE.md retains the full operational inventory |
| (ref) | [HTML scraping patterns](./dev/html-scraping-patterns.md) | Directory markup shapes used by the parsers |
| (ref) | [Site UI](./dev/site-ui.md) | Compact embed-mode and UI reference; CLAUDE.md retains detailed behavior |
| (runbook) | [Mobile visual testing](./dev/mobile-visual-testing.md) | Phone-sized manual/headless review, screenshots, service-worker isolation, and encrypted-build restoration |
| (runbook) | [Annual map and GIS update](./dev/annual-map-update.md) | Year rollover for city geometry, official POIs/layers, validation, mobile review, and deployment configuration |
| (plan) | [Roadmap](./roadmap.md) | Ideas and scaling thresholds, not current commitments |

## Adding a new doc

- Pick the next free number, lowercase-hyphenated name. No spaces.
- Follow the template below. Date is the day you write it.
- Add a row to this index.
- If the topic touches code architecture, link from `CLAUDE.md`'s
  "Architecture docs" section so future Claude planning sees it.

```markdown
---
title: <Title>
date: YYYY-MM-DD
status: current  # or: superseded by ./NN-…, deprecated, draft
---

# <Title>

## Overview
…

## Decisions
…

## Mechanism
…

## Failure modes & trade-offs
…

## Code references
…
```
