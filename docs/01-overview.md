# System Overview

**Status:** Accepted
**Last updated:** 2026-08-16

## Overview

Playa Camps is a private-audience, password-gated, offline-capable static PWA
built from cached annual Burning Man API snapshots and official GIS layers. The
repo contains code and source-independent assets; Event Data and derived vectors
stay out of git.

## Decisions

- Static GitHub Pages hosting keeps the runtime simple: no app server, accounts,
  cookies, or application analytics.
- Annual `api-YYYY` snapshots are the only record sources. The configured current
  BRC year is primary and older years are optional secondary sources.
- API keys exist only during explicit operator refreshes. Push-triggered and
  ordinary manual builds reuse encrypted Release snapshots and never fetch
  Event Data.
- The Preact client is bundled into the generated HTML; the semantic search
  runtime and vectors are separate opt-in assets.
- Source payloads can use a single password or named envelope-encryption tiers.
- A service worker supplies offline shell/data behavior and cleans retired cache
  namespaces during activation.
- Local state is annual-source-scoped and optionally synchronized to a Dropbox
  App folder using PKCE and mergeable tombstones.

## Mechanism

```text
manual API refresh -> encrypted annual Release snapshot
                                  |
main push/manual deploy -> tests -> download snapshots -> optional GIS refresh
                        -> bundle -> normalize/tag/embed/encrypt -> Pages artifact
                        -> GitHub Pages -> Cloudflare -> password gate -> offline PWA
```

The builder loads each annual cache once into camps/events/art plus `fetched_at`.
It validates source order and current-year size, derives visible freshness from
the current-year cache, creates a separate build version, and emits the HTML,
privacy page, worker, lazy semantic runtime, and optional embeddings.

The client unlocks only the sources granted by the selected tier, applies the
current-year location embargo unless the wrapper is trusted, and scopes all
favorite/share/import/sync behavior to the selected `api-YYYY`.

## Failure modes and trade-offs

- Cached data can be stale; the UI displays its actual fetch date.
- A missing configured snapshot fails the build rather than serving an older
  year as current.
- GIS is optional and exact-year; missing geometry disables map features for
  that year.
- Offline clients can remain on an old encrypted build until reconnecting.
- Static hosting means every data update deploys a new artifact.

## Code references

- `backend/src/playa/cli.py`
- `backend/src/playa/sources/api.py`
- `backend/src/playa/builder.py`
- `client/src/components/App.tsx`
- `client/src/hooks/useSource.ts`
- `.github/workflows/refresh.yml`
