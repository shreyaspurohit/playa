---
title: Client Architecture Reference
date: 2026-08-06
status: current
---

# Client Architecture Reference

The client is a strict-TypeScript Preact app bundled by esbuild into a single
IIFE. It has no runtime package CDN or source-data API dependency.

## Important entry points

- `src/index.tsx` — mounts `App`.
- `src/components/App.tsx` — routing, source/data lifecycle, filters, modal
  state, sharing, and feature wiring.
- `src/data.ts` — discovers and decodes plaintext, legacy encrypted, or
  multi-tier envelope payloads.
- `src/crypto.ts` — PBKDF2/AES-CBC payload and wrapper decryption.
- `src/types.ts` — data types and storage keys.
- `src/hooks/useSource.ts` — embedded source list, selected source, map year,
  and legacy storage migration.
- `src/utils/embargo.ts` — current-year API location masking.

Components are grouped by visible surface (`CampsView`, `ArtView`, `MapView`,
`ScheduleView`) and shared controls (`Header`, `Toolbar`, `TabBar`, modals,
banners, gates). User state lives in focused hooks under `src/hooks/`.

## Build boundary

1. `npm run build` creates `client/dist/bundle.js`.
2. `SiteBuilder` embeds that IIFE into the HTML template.
3. Metadata describes available sources, version, dates, wrapper indices, and
   release notes.
4. Embedded script elements carry per-source camps/art payloads.
5. `readEmbeddedPayload()` detects the active format and `App` runs the
   matching plain, legacy-gate, or envelope-gate flow.

## Source and unlock lifecycle

`useSource()` reads `bm-sources` metadata and validates the persisted
selection. Envelope unlock returns a `Map<Source, DEK+IV>` plus the trusted
flag. `App` filters the source picker to keys present in that map and lazily
decrypts the selected source, caching decrypted camps and art in refs.

If a persisted source was not unlocked, `App` changes it to the first unlocked
source. Visible source labels and disclaimers use a derived source immediately,
because the corrective effect runs after paint.

Source-dependent localStorage keys are recomputed from the selected source.
Global preferences remain unsuffixed.

## Rendering and derived state

Expensive search/tag/favorite derivations use `useMemo`. Search haystacks are
indexed once when data is ingested. Text highlighting returns text/VNode arrays
and treats queries literally. Maps and schedules consume the same filtered and
favorite state owned by `App`.

The sticky `.site-chrome` wrapper contains the header, tabs, action bar, and
status banners. Main views remain below it.

## Testing

```bash
make test-js
cd client && npm run typecheck
```

Tests use Node's test runner, `tsx`, and happy-dom. Add focused tests for pure
utilities and mounted component behavior. Cryptography tests round-trip against
the openssl wire format used by Python. Do not put an exact suite count in this
document; it changes frequently.

## Development loop

```bash
make bundle-watch
make rebuild
make preview
```

There is no hot reload. Rebuild the generated site after bundle changes and
refresh the browser.
