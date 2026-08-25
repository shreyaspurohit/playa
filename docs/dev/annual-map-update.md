# Annual Map and Source Update

Use this checklist when adding a new burn year. Keep API source identity, map
geometry, GIS normalization, calendar dates, and release policy explicit; do not
borrow another year's geometry.

## Inputs

- Official city measurements and plan for the year.
- Official GIS repository files for the year.
- A refreshed encrypted `api-YYYY` snapshot.
- Confirmed burn-calendar dates and camp/art location release instants.

## Code and configuration

1. Add and review `BRC_YYYY` in `client/src/map/data.ts`, then register it in
   `BRC_BY_YEAR` only when geometry is complete.
2. Set `BRC_MAP_YEAR=YYYY` and include `YYYY` in `BM_API_YEARS`.
3. Update all three `SITE_TIERS`: god and demigod receive all configured annual
   sources; spirit receives only `api-YYYY`.
4. Verify the event dates on an official Burning Man Project page, record its
   link, add the exact same-year window to
   `backend/src/playa/schedule.py::ANNUAL_EVENT_WINDOWS`. Set
   `CAMP_LOCATION_RELEASE_AT` and `ART_LOCATION_RELEASE_AT` from current official
   communications as well. There is no schedule-date environment override.
5. Run a strict GIS refresh and inspect the normalized payload:

   ```bash
   python3 -m playa gis-fetch --year YYYY --force
   python3 -m playa map-audit --year YYYY \
     --street-lines /tmp/brc-YYYY-street-lines.geojson \
     --center LAT,LNG --esplanade-radius-feet FEET
   ```

6. Review the POI allowlist and toilet polygon normalization. HTTP 404 is an
   acceptable staged no-overlay state; schema errors are not.
7. Manually refresh the API year, then rebuild from its cache.

## Acceptance

- Current source resolves to the new geometry exactly once.
- Previous annual sources retain their own geometry.
- A staged source with no geometry keeps browse/schedule usable and disables
  only geometry-dependent controls.
- Camp, art, rendezvous, official POI, GPS, zoom/pan, and layer controls work in
  light/dark themes and the 390×844 viewport.
- Current-year camp/art location masks follow their independent timestamps for
  spirit and demigod, while trusted god can validate the retained coordinates.
- The generated `bm-brc-map-year` and `bm-sources` values match configuration.
- The generated `bm-schedule-windows` contains the independently reviewed
  bounds for every embedded source and no window crosses a calendar year.
- Tests, typecheck, bundle, service-worker syntax, and `git diff --check` pass.

## Annual record

Record the year, official input links/digests, GIS revision, reviewed center and
radii, API snapshot `fetched_at`, release timestamps, and reviewer. Never commit
the downloaded Event Data or generated site.
