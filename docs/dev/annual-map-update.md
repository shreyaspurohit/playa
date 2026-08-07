---
title: Annual map and GIS update runbook
date: 2026-08-06
status: current
---

# Annual map and GIS update runbook

## Purpose

Use this runbook when Burning Man publishes the next Black Rock City plan and
official GIS files. It covers both parts of the map that change each year:

1. the city geometry in `client/src/map/data.ts` (Golden Spike, streets,
   orientation, and trash fence); and
2. the official GIS overlay normalized by `backend/src/playa/gis.py` (Temple,
   medical/ESD, Rangers, ice, toilets, services, transport, and arrival POIs).

Do not treat this as a mechanical year-number replacement. Upstream filenames,
feature names, schemas, city geometry, participant guidance, and release timing
can all change. Preserve every historical `BRC_BY_YEAR` entry because past API
sources still use it.

The design rationale and data contract live in
[`../10-map-system.md`](../10-map-system.md). Use
[`mobile-visual-testing.md`](./mobile-visual-testing.md) for the required phone
review.

## Definition of done

Source rollover and map completion are separate milestones. A new camp/API
source may safely deploy before its map: the Map tab reports that geometry is
not available for that year, and no other year's coordinates are substituted.
The full annual map update is complete only when all of these are true:

- The new year has its own reviewed `BrcMapData` entry; old years remain.
- `DIRECTORY_YEAR`, backend defaults, local configuration, and CI configuration
  agree on the active directory map year.
- A forced GIS fetch either records the new provenance/digests or explicitly
  reports that the year's GIS files are not published yet. A 404 does not block
  the rest of the application.
- Every included CPN name was deliberately mapped to a stable ID, label, kind,
  and layer; unknown operational points remain excluded.
- Medical/ESD, Rangers, and the Temple are present and not hideable. The exact
  trash fence is present under the default-off Boundary layer.
- Essentials defaults on and contains Arctica ice.
- Boundary and Toilets have their own layers and default off, regardless of how
  an older cache labeled toilets.
- Services, Transport, and Arrival default off. Transport and Arrival fit their
  distant markers only while explicitly enabled; disabling them restores the
  compact map. A sole selected POI also reframes into view.
- The official Center Camp Plaza footprint is present for the selected year,
  overlays the generic street grid, and opens the existing Center Camp details
  rather than creating a duplicate list item.
- POI selection shows its label/details and external navigation behavior.
- The full test suite, typecheck, production-shaped encrypted rebuild, and
  phone-sized visual review pass.
- Repository variables/secrets and release notes are updated before deployment.

## Timing and safe rollout

Annual inputs usually arrive in stages. It is safe to activate a data source
before its map, but never safe to display it with another year's geometry.

| Stage | Typical timing | Safe action |
|---|---|---|
| City plan / measurements | Spring or early summer | Prepare and test the new `BrcMapData` entry. Until complete, that year's Map tab stays unavailable. |
| GIS year directory | Often later in summer | Inspect schema/names, update the allowlist, then force-fetch and normalize. HTTP 404 remains a valid no-overlay state. |
| Directory/API rollover | When current-year data is actually live | Update source-year configuration and tier source lists even if the map is pending; verify the unavailable-map state. |
| Production release | After all gates below pass | Deploy with a user-facing `rn:` commit. |

If the Golden Spike is published before the exact fence or street measurements,
keep the geometry entry in a review branch or clearly marked draft. The source
itself can still go live with its Map tab unavailable. Do not combine new center
coordinates with last year's fence in production: the result looks plausible
but is geographically wrong.

## Sources to verify each year

Search for and open the current year's official pages; do not assume changing
the year in an old URL is sufficient.

- City plan and street-name narrative:
  `https://burningman.org/black-rock-city/black-rock-city-YYYY/`
- Golden Spike/general city-map dataset:
  `https://innovate.burningman.org/dataset/YYYY-golden-spike-and-general-city-map-data/`
- Innovate's year/release index, which links the current GIS, Golden Spike,
  measurements, and plan artifacts:
  `https://innovate.burningman.org/datasets-page/`
- Measurements PDF linked by one of those pages: street widths/block depths,
  orientation, and five fence vertices.
- City-plan PDF: actual radial streets and letter-street set.
- Official GIS repository year directory:
  `https://github.com/burningmantech/innovate-GIS-data/tree/master/YYYY/GeoJSON`
- Current participant/Survival Guide pages for medical, Rangers, Arctica,
  toilets, Playa Info, transport, Gate, and ticketing dates.
- Current Innovate API/dataset Terms before fetching or changing presentation.

Record the exact source URLs and access date in the new year's comment in
`data.ts` or in the annual audit table at the end of this file. Never fabricate
coordinates or infer a participant-facing purpose from an opaque GIS name.

## Files and configuration that own the behavior

| Location | Annual responsibility |
|---|---|
| `client/src/map/data.ts` | Append `BRC_YYYY` and register it in `BRC_BY_YEAR` when geometry is complete. Bump `DIRECTORY_YEAR` when the directory source rolls over even if geometry is pending; exact resolution will keep its map unavailable. |
| `backend/src/playa/gis.py` | Review `GIS_FILENAMES`, `POI_RULES`, and `AREA_RULES`; retain stable IDs and add reviewed upstream aliases. Toilet output must use layer `toilets`; Center Camp area must link to POI `center-camp`. |
| `backend/src/playa/config.py` | Bump the fallback `directory_map_year` and `BRC_MAP_YEAR` fallback when the directory source rolls over. Burn dates remain environment values, not code defaults. |
| `.github/workflows/refresh.yml` | Bump the fallback map year; normal production configuration should come from repository variables. |
| `Makefile` | Update year examples/default descriptions if they name the old year. Do not put secrets here. |
| `.env` (local, ignored) | Set the new map year, burn window, API years, and tier manifest for a production-shaped local build. |
| GitHub Actions variables | Update `BRC_MAP_YEAR`, `BM_API_YEARS`, `BURN_WINDOW_OPEN_FROM`, `BURN_WINDOW_OPEN_TO`, `CAMP_LOCATION_RELEASE_AT`, and `ART_LOCATION_RELEASE_AT`. |
| GitHub Actions secrets | If a new `api-YYYY` source is enabled, update the `SITE_TIERS` source lists and ensure the API/cache credentials are configured. |
| `backend/tests/test_gis.py` | Add annual aliases/introduction-year cases; keep prior-year drift as regression coverage. |
| `client/tests/gis.test.ts` and `MapView.test.ts` | Preserve layer defaults, old-cache toilet migration, selection, accessibility, and extent/aspect-ratio coverage. |

`data/gis/YYYY/` and built `site/` output are gitignored operational artifacts.
Do not commit them as an accidental public mirror of upstream or private data.

## Step 1 — start from a known state

Choose the year explicitly and inspect the worktree before editing:

```bash
export MAP_UPDATE_YEAR=2027
git status --short
```

Preserve unrelated changes. If the current branch already contains map work,
understand it before editing; do not reset it away.

## Step 2 — inspect upstream before changing code

Confirm the year directory and exact filenames in the official GIS repository.
The current importer expects `cpns.geojson`, `plazas.geojson`, and
`toilets.geojson`, but the
upstream project is allowed to rename or reshape them.

Also download `street_lines.geojson` to a temporary file for the geometry
audit. It is deliberately not one of `GIS_FILENAMES`: the client ships the
small reviewed centerline/radial constants, not the roughly 236 KB raw street
export.

```bash
curl -L --fail --silent --show-error \
  "https://raw.githubusercontent.com/burningmantech/innovate-GIS-data/master/$MAP_UPDATE_YEAR/GeoJSON/street_lines.geojson" \
  -o "/tmp/brc-$MAP_UPDATE_YEAR-street-lines.geojson"
```

After reading the official Golden Spike and Esplanade centerline radius from
the annual dataset/Measurements PDF, run the read-only extractor:

```bash
python3 -m playa map-audit \
  --year "$MAP_UPDATE_YEAR" \
  --street-lines "/tmp/brc-$MAP_UPDATE_YEAR-street-lines.geojson" \
  --center "<GOLDEN_SPIKE_LAT>,<GOLDEN_SPIKE_LNG>" \
  --esplanade-radius-feet <OFFICIAL_RADIUS> \
  --output "/tmp/brc-$MAP_UPDATE_YEAR-map-audit.json"
```

The command validates the FeatureCollection, LineString geometry, coordinate
order/bounds, property schema, feature count, and digest. It separates uniform
annular streets from connector roads, calibrates coordinate-rounding error
against the official Esplanade radius, derives candidate centerline radii and
each radial's innermost street, and prints copyable `BrcMapData` fields. It does
not download at runtime, edit `data.ts`, infer the Golden Spike/fence, or enter
the normal build dependency graph. Review every warning and retain the JSON
report in `/tmp` for the annual audit; do not commit the full upstream export.

Inspect its annual property schema before filtering. In 2025 the street name
and class fields were `name`/`type`; in 2026 they were `name` plus
`source`/`kind`. Treat those observed differences as examples, not a permanent
union of every future spelling.

After confirming those paths, attempt the forced fetch now:

```bash
python3 -m playa gis-fetch --year "$MAP_UPDATE_YEAR" --force
```

It may fail normalization because a required POI was renamed. That is useful:
the successfully parsed raw files are written before normalization, while the
old normalized cache is not replaced. Inspect those raw files rather than
eyeballing the entire payload. Step 5 reruns the command after the allowlist and
schema changes are reviewed.

```bash
jq '{type, features:(.features|length), geometry_types:(.features|map(.geometry.type)|unique), property_keys:(.features|map(.properties|keys)|add|unique)}' \
  data/gis/$MAP_UPDATE_YEAR/cpns.geojson

jq -r '.features[].properties.NAME // empty' \
  data/gis/$MAP_UPDATE_YEAR/cpns.geojson | sort -fu

jq '{type, features:(.features|length), geometry_types:(.features|map(.geometry.type)|unique), property_keys:(.features|map(.properties|keys)|add|unique), names:(.features|map(.properties.name // .properties.Name // .properties.NAME))}' \
  data/gis/$MAP_UPDATE_YEAR/plazas.geojson

jq '{type, features:(.features|length), geometry_types:(.features|map(.geometry.type)|unique), classes:(.features|map(.properties.class)|unique)}' \
  data/gis/$MAP_UPDATE_YEAR/toilets.geojson
```

Review coordinate ordering and bounds. GeoJSON is `[longitude, latitude]`.
Coordinates around `[-119, 40]` are plausible; `[40, -119]` indicates an
ordering bug. A projected coordinate system or a location far outside the BRC
region must fail validation, not be coerced.

If filenames, geometry types, or property names changed, update the importer
and fixtures deliberately before continuing. Do not add every new file merely
because it exists; large block/street polygons are not currently part of the
mobile rendering contract.

For the plaza export, verify that `Center Camp Plaza` exists and record which
name-property casing the year uses. The importer supports the observed
`name`, `Name`, and `NAME` variants, but a new spelling or geometry type must be
reviewed rather than silently ignored.

## Step 3 — append the new city geometry

In `client/src/map/data.ts`, add a new constant alongside the old years:

```ts
const BRC_2027: BrcMapData = {
  year: 2027,
  center: { lat: /* Golden Spike */, lng: /* Golden Spike */ },
  twelveBearingDeg: /* derived from the published orientation */,
  streetRadiiFeet: [/* Esplanade through the outermost letter */],
  streetLetters: ['Esplanade', /* A ... */],
  streetNames: ['Esplanade', /* current themed names */],
  radialStreets: [/* clock plus inner street for each visible radial */],
  fencePentagon: [/* all five exact published vertices */],
};

export const BRC_BY_YEAR: Record<number, BrcMapData> = {
  // existing historical entries stay
  2027: BRC_2027,
};
```

When the directory has actually rolled over, change `DIRECTORY_YEAR` to the new
year even if this geometry entry is still pending. Exact-year resolution will
show an unavailable Map tab until `BRC_YYYY` is reviewed and registered. Do not
overwrite or delete the previous constant. `api-YYYY` sources resolve through
`BRC_BY_YEAR`, so history is functional data rather than commentary.

Check all parallel arrays carefully:

- `streetLetters.length === streetRadiiFeet.length`
- `streetNames.length === streetLetters.length`
- radii are strictly increasing
- radii are street **centerlines**, not accumulated clear block depths. Prefer
  measuring them directly from official `street_lines.geojson`; when deriving
  from the Measurements PDF, add `half inner-street width + clear block depth
  + half outer-street width` for every adjacent pair. Cross-check several
  exported line vertices against the resulting radii so an error cannot
  compound toward the outer streets.
- every official radial from 2:00 through 10:00 is represented with its annual
  inner endpoint. In the 2025/2026 plans, `:00`/`:30` begin at Esplanade and
  `:15`/`:45` begin at F; do not assume that split for a future year without
  inspecting `street_lines.geojson`.
- the Golden Spike maps near SVG `(0, 0)`
- known clock/letter addresses land on the expected side and ring
- every fence vertex uses `{lat, lng}`, not GeoJSON ordering

The generated radii/radials are candidates, not authority for fields the
street export cannot establish. Manually add and verify `center`,
`twelveBearingDeg`, `streetNames`, and `fencePentagon`. Never have the tool
rewrite a historical `BRC_BY_YEAR` entry.

If true north no longer follows the historical 4:30 axis, store the newly
derived `twelveBearingDeg`; do not preserve `45` by habit. An N/S-axis statement
is directionally ambiguous, so verify the result against official Temple,
3:00/9:00 station, and Center Camp CPN coordinates. If the city stops
using the polar clock/letter plan, stop—the renderer is no longer year-stable
and this requires a design change, not an annual data refresh.

Delete the temporary street export after the audit. Do not add it to
`data/gis/YYYY/`: that directory is the runtime overlay cache and adding a new
file there would blur the boundary between reviewed base-map constants and
embedded GIS overlays.

## Step 4 — audit and classify official POIs

Compare the new `cpns.geojson` names with the prior year. Review every addition,
removal, and rename against current participant-facing documentation.

For `POI_RULES`:

- Keep the existing stable `id` when the same real destination is merely
  renamed upstream.
- Add the new upstream spelling to `source_names`; retain the prior alias for
  past-year normalization/tests.
- Use `required_from` for a destination that legitimately did not exist in
  earlier fixtures.
- Fail the current-year fetch when a required safety/orientation destination
  disappears unexpectedly.
- Keep the upstream `source_name` in normalized output for provenance.
- Do not turn generic survey records such as `Point 1` into participant POIs.

For `AREA_RULES`, keep the annual Center Camp footprint separate from its CPN:

- preserve the full Polygon/MultiPolygon and all rings in GeoJSON order;
- retain the stable area id `center-camp-plaza`;
- retain `poi_id: center-camp` so tapping the footprint reuses the existing
  list row, label, and navigation;
- never approximate the polygon from the point/address or copy it from a prior
  year when the current export is unavailable.

Apply this layer policy:

| Layer | Default | Contents |
|---|---|---|
| `base` | Always on | Temple, medical/ESD, Rangers, and other approved non-hideable orientation/safety anchors |
| `essentials` | On | Arctica ice locations |
| `toilets` | Off | Every toilet-bank footprint and centroid; never put these back in Essentials |
| `services` | Off | Playa Info/Placement/Lost & Found, ARTery, recycling, Yellow Bikes |
| `transport` | Off | Burner Express Bus and airport |
| `arrival` | Off | Gate/Greeters, Box Office/Will Call, DMV, Media Mecca, and approved arrival infrastructure |

Co-located services should normally share one marker and detail panel. Avoid
stacking separate icons at Playa Info or Center Camp when the dataset is
describing services at the same coordinate.

Review toilet geometry separately:

- every feature must still be a `Polygon` unless support is intentionally
  extended and tested;
- preserve all rings and `[longitude, latitude]` pairs;
- inspect feature count and `class` values for surprising changes;
- normalized records must emit `kind: "toilet"` and `layer: "toilets"`;
- IDs must be unique and stable enough for selection within that map year.

## Step 5 — force-fetch and validate the new GIS year

Use `--force`. Without it, a previously validated cache is intentionally reused
and changes to aliases/layers will not regenerate `normalized.json`. This is the
post-review rerun of the initial fetch from Step 2.

```bash
python3 -m playa gis-fetch --year "$MAP_UPDATE_YEAR" --force
```

Inspect the compact output:

```bash
jq '{year, source, retrieved_at, files, point_count:(.points|length), area_count:(.areas|length), toilet_count:(.toilets|length), layers:([.points[].layer,.toilets[].layer]|group_by(.)|map({layer:.[0],count:length})), point_ids:[.points[].id], area_ids:[.areas[].id]}' \
  data/gis/$MAP_UPDATE_YEAR/normalized.json

jq -e 'all(.toilets[]; .kind == "toilet" and .layer == "toilets")' \
  data/gis/$MAP_UPDATE_YEAR/normalized.json

jq -e 'any(.areas[]; .id == "center-camp-plaza" and .poi_id == "center-camp" and (.polygons|length) > 0)' \
  data/gis/$MAP_UPDATE_YEAR/normalized.json
```

Manually verify at least one destination in every included layer and each
required medical/Ranger location. Counts are review signals, not permanent
cross-year assertions: a changed count may be correct, but it must be explained.

The fetcher writes raw files only after JSON parsing and atomically replaces the
normalized cache only after validation. If a forced refresh fails, keep the
last validated cache for diagnosis; do not weaken validation to make the build
green.

HTTP 404 is handled differently because it means an annual GIS file is not
published yet: with no cache, the command warns and returns successfully so the
site can build without that year's overlays; with a validated same-year cache,
it retains that cache. Non-404 network errors and invalid published data still
fail this explicit command loudly.

That strictness is deliberate for this operator review. Routine `make build`,
`make rebuild`, `make dev`, and nightly `python -m playa all` instead invoke
GIS refresh in best-effort mode. They report a failure for each affected year,
retain any validated same-year normalized cache, and continue the camp/event/
art deployment without an overlay when no cache exists. Do not use
`--best-effort` for the annual acceptance step above.

In CI, `data/gis` is restored only from an exact cache key containing the
upstream GIS commit and configured directory/API years. Consequently the
nightly pipeline does not force-download unchanged files. Publishing a new GIS
commit or changing the enabled year set creates a miss and refreshes once. The
annual command above still uses `--force` because it is explicitly validating
reviewed alias/layer changes against upstream.

## Step 6 — update year configuration

When the source rolls over, make its active-year values agree even if the map is
still pending. Map geometry and GIS completion can follow independently:

1. `client/src/map/data.ts`: `DIRECTORY_YEAR` and `BRC_BY_YEAR`.
2. `backend/src/playa/config.py`: `directory_map_year` default and the
   `BRC_MAP_YEAR` fallback in `Config.from_env()`.
3. `.github/workflows/refresh.yml`: fallback `BRC_MAP_YEAR`.
4. `Makefile` and operational examples that claim a particular default year.
5. Local `.env`: `BRC_MAP_YEAR`, new burn-window dates, the official camp/art
   location release timestamps (with Pacific offset), and any new API source.
6. GitHub repository variables: `BRC_MAP_YEAR`, `BM_API_YEARS`,
   `BURN_WINDOW_OPEN_FROM`, `BURN_WINDOW_OPEN_TO`,
   `CAMP_LOCATION_RELEASE_AT`, and `ART_LOCATION_RELEASE_AT`.
7. `SITE_TIERS` secret/source lists if `api-YYYY` is introduced. Confirm that
   god/demigod/spirit tiers unlock exactly the intended sources.

The burn window and API location schedule are intentionally configuration, not
Python constants. Get the burn dates from the current ticketing/event page and
the two public location timestamps from the official Innovate API schedule.
They serve different purposes. A current-year API build must fail on missing,
timezone-naive, reversed, or prior-year location timestamps rather than reuse a
stale cutoff.

Before adding `api-YYYY` to `BM_API_YEARS` or a tier, ensure its encrypted API
cache exists and can be decrypted with the configured `BM_CACHE_PASSWORD`.
Map geometry being ready does not imply camp/event/art API data is ready.

On the official **developer** location release (2026: August 9 at midnight
PDT), manually run **Refresh camps directory** with
`refresh_api_years=YYYY`. The Release cache is otherwise intentionally reused,
so a snapshot fetched before that date will not acquire the newly populated
location fields by itself. Verify god-mode sees those fields after deploy while
spirit-mode still masks camps/art until their separate public timestamps.

## Step 7 — automated verification

Update/add fixtures without deleting prior-year regression cases, then run:

```bash
make test
cd client && npm run typecheck && npm run build && cd ..
make rebuild
git diff --check
git status --short
```

The production-shaped rebuild must use the real local `.env` tier shape. Check
its summary for:

- the expected modes, tiers, and sources;
- the new GIS year exactly once even when directory and API share a year, or a
  clear not-yet-published warning;
- non-zero expected POI/toilet data when GIS is published;
- no plaintext camp payload in an encrypted build.

Keep or add focused assertions for:

- old and new CPN aliases resolving to the same stable ID;
- intentional `required_from` behavior;
- toilet layer `toilets` at normalization and in the client, including migration
  of old cached records that say `essentials`;
- defaults: Essentials on; Boundary/Toilets/Services/Transport/Arrival off;
- compact default extent, full-fence Boundary extent, and matching SVG/viewBox
  aspect ratio in both states;
- Transport/Arrival layer-enable fitting, return to the compact extent when
  disabled, sole-selected distant POI reframing, and nearest-marker resolution for the
  Gate/Box Office/Will Call cluster;
- annual Center Camp polygon rendering, tap/keyboard delegation to the existing
  Center Camp POI, and no duplicate landmarks row;
- source-to-year selection for `directory`, `api-YYYY`, and prior API years;
- missing future-year geometry rendering no SVG/coordinates while camps,
  events, art, favorites, and schedules remain usable;
- a current-year API fixture with released camp locations rendering its
  favorite/home markers on that exact year's geometry. Keep this case even
  while production locations are embargoed or upstream fields are blank;
- Schedule Near-me disabled only for the source without exact geometry;
- GIS HTTP 404 continuing without a cache and retaining a valid same-year cache;
- non-404/network/schema/name drift failing the explicit command while the
  automatic build path warns and continues, including later GIS years;
- unchanged nightly GIS revision reusing the exact workflow cache without a
  forced download, while a revision/year-set change causes a cache miss;
- switching from a mapped year with “Near me” active to a geometry-missing year
  clears only that coordinate-dependent filter;
- POI tap/keyboard selection, details, GPS navigation, and external link;
- hidden-layer selection cleanup.

## Step 8 — required mobile visual review

Follow [`mobile-visual-testing.md`](./mobile-visual-testing.md), using at least
390×844, 360×800, and 430×932 viewports. Capture and inspect:

1. First load: Essentials on; Boundary, Toilets, Services, Transport, and
   Arrival off; compact city grid remains readable.
2. Boundary enabled: full-fence overview with no clipping or avoidable
   letterboxing; disabling it restores the compact extent.
3. Transport and Arrival enabled separately: every marker is inside the fitted
   view; disabling each layer restores the compact city view.
4. Center Camp: the official footprint covers the annual plaza cutout, the
   marker remains correctly placed, and tapping either opens one details row.
5. Toilets enabled: density is usable, footprints/`WC` markers are tappable,
   and there are no 45 permanent text labels.
6. A selected toilet: label, details, location, distance/bearing/ETA state, and
   external-map link appear like other POIs.
7. Medical, Ranger, Temple, ice, and one POI from every optional layer.
8. Layer pills at narrow width: horizontal scrolling and 44px touch targets.
9. Light/dark themes, zoom/pan, many user pins, directory source, and each API
   source.
10. Refresh: layer preference persists and a hidden selected POI is cleared.

Screenshots may contain protected event information. Keep them in a temporary
directory, do not commit them, and restore/verify the encrypted site build after
any plaintext visual-test build.

## Step 9 — release and post-deploy check

Before merging/deploying:

- Review the diff for accidental fetched data, generated HTML, secrets, or loss
  of historical geometry/tests.
- Update this runbook's audit table with source revision/date and meaningful
  annual changes.
- Use a user-facing release-note commit, for example:
  `rn: update the map and official service locations for 2027`.
- Let the normal encrypted CI build deploy; do not upload a hand-built site.

After deployment, test on an actual phone:

- unlock each intended tier;
- switch between directory and API sources and confirm the geometry year;
- confirm toilets start off on a clean profile;
- enable Toilets and tap a bank;
- confirm Boundary starts off, then enable it and confirm the full fence plus
  important base POIs;
- reload once online, then test an offline reload through the installed PWA.

If geometry is intentionally pending, replace the fence/POI checks for that
source with verification of the year-specific unavailable message, absence of
an SVG map/layer controls, working non-map views, and correct maps for every
older enabled source.

If production is wrong, revert the code/configuration change and redeploy the
last known-good build. Do not delete historical `BRC_BY_YEAR` entries or loosen
GIS validation as a rollback technique.

## Annual audit record

Add one row per completed year. Link exact official pages or record the upstream
Git revision in the change/commit description when a URL is unstable.

| Map year | Reviewed on | GIS source/revision | Meaningful changes | Reviewer |
|---|---|---|---|---|
| 2026 | 2026-08-07 | `burningmantech/innovate-GIS-data`, 2025/2026 GeoJSON | Added official curated POIs, 45 toilet banks, and annual Center Camp Plaza footprint; Toilets and exact Boundary are default-off layers; Boundary/Transport/Arrival fit only while enabled; 2025 `Name` vs 2026 `name` plaza schema drift covered | project owner + implementation review |
| YYYY | YYYY-MM-DD | URL/revision | Geometry, aliases, additions/removals, layer changes | name |

## Common failure modes

- **`gis-fetch` says “using cached” after code changed:** rerun with `--force`.
- **Required POI missing:** inspect renamed upstream features/current guidance;
  add a reviewed alias or explain a real removal. Do not mark it optional merely
  to pass.
- **Map appears tiny:** verify the viewBox aspect ratio first. The exact fence is
  wider than the compact city and Transport/Arrival include distant points, so
  those explicitly enabled layers legitimately reduce city scale. Disable them
  to restore the compact view. A stale fixed CSS ratio adds avoidable
  letterboxing.
- **Toilets appear on first load:** confirm backend normalization says
  `toilets`, client validation canonicalizes old caches, and no persisted local
  preference enabled the layer. Test a clean profile.
- **New API source shows a different year's geometry:** this is a bug. Exact
  year resolution must return either `BRC_BY_YEAR[YYYY]` or no map—never the
  newest known entry.
- **New source has no map:** expected during staged release. Confirm the source
  year is correct, non-map views work, and older exact-year maps still render.
- **Directory uses the wrong geometry:** align `DIRECTORY_YEAR`,
  `BRC_MAP_YEAR`, backend/workflow fallbacks, and the embedded
  `bm-directory-map-year` meta value.
- **Local preview differs from production:** rebuild with the same year/source/
  tier shape as CI, clear or isolate the service worker, and repeat the mobile
  runbook.
