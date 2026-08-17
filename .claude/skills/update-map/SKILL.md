---
name: update-map
description: Refresh the year-keyed BRC geometry and official GIS layers for a new burn year. Use when Burning Man has published the new year's city plan (usually April–June) or GIS dataset (usually later), or when the user says "update the map for 2027" / "new year's map" / "the BRC plan is out".
---

# update-map

Each year Black Rock City's layout shifts: new center coordinates
("Golden Spike"), new axis-of-true-north, slightly different block
depths, a new set of themed street names, and a **new burn-week
calendar window** (e.g., 2026 = Sun Aug 30 → Mon Sep 7). The official
GIS export also changes feature names, coordinates, and sometimes its
schema. This skill pulls and reviews both sets of year-specific data.

**Before acting, read the canonical operator runbook completely:**
`docs/dev/annual-map-update.md`. It owns the current file list, GIS
allowlist/layer policy, forced-cache refresh, CI configuration, mobile
review, and encrypted-build restoration. If this skill conflicts with
that runbook, follow the runbook and correct this skill in the same change.

**Only the base-grid measurement step is automated.** Burning Man publishes
the Golden Spike, orientation, fence, and some names in PDFs/rendered pages,
while GIS arrives separately. `playa map-audit` safely derives candidate street
radii and radial ranges from the official street export, but the skill still
reviews every source and applies targeted edits by hand.

## When to run

- A new city plan page is linked from `burningman.org/black-rock-city/`
- The "Golden Spike and General City Map Data" dataset updates for a
  new year at `innovate.burningman.org/dataset/`
- The user says "update the map" / "new year's plan is out" / "bump
  the BRC map to 20YY"

## Inputs you need (human-readable URLs)

These are candidate annual URL patterns. Search the official sites and verify
the actual current links rather than assuming a year substitution exists.

1. **City plan page** (theme + street names + narrative)
   `https://burningman.org/black-rock-city/black-rock-city-<YEAR>/<YEAR>-black-rock-city-plan/`
2. **Innovate page** (Golden Spike coords)
   `https://innovate.burningman.org/dataset/<YEAR>-golden-spike-and-general-city-map-data/`
3. **Measurements PDF** (block depths, orientation, fence vertices)
   Usually linked from #1 as `https://webassets.burningman.org/pdfs/<YEAR>-brc-measurements.pdf`
   — may also live at `bm-innovate.s3.amazonaws.com/<YEAR>/...`
4. **City plan PDF** (radial streets — whether 2:30, 2:45, 8:45 exist)
   Linked from #1 as `https://webassets.burningman.org/pdfs/BRC_City_Plan_<YEAR>_update.pdf`
5. **Ticketing / gate dates** (burn-week start and end)
   `https://burningman.org/black-rock-city/ticketing-information/` — the
   header reads "Sunday, August 30 to Monday, September 7, 2026" (or
   whatever the year is). These drive the calendar columns and event
   date labels in the built site.

## Step 1 — snapshot the sources locally

```bash
export YEAR=2027   # change me
mkdir -p /tmp/brc-$YEAR
curl -sS -L -A "Mozilla/5.0" "https://webassets.burningman.org/pdfs/BRC_City_Plan_${YEAR}_update.pdf" \
  -o /tmp/brc-$YEAR/plan.pdf
curl -sS -L -A "Mozilla/5.0" "https://webassets.burningman.org/pdfs/${YEAR}-brc-measurements.pdf" \
  -o /tmp/brc-$YEAR/measurements.pdf
curl -sS -L \
  "https://raw.githubusercontent.com/burningmantech/innovate-GIS-data/master/${YEAR}/GeoJSON/street_lines.geojson" \
  -o /tmp/brc-$YEAR/street_lines.geojson
```

`WebFetch` the Innovate dataset page directly (it's HTML):

```
innovate.burningman.org/dataset/<YEAR>-golden-spike-and-general-city-map-data/
```

Pull the Golden Spike coordinate from the official dataset. It is typically
formatted as "<lat>, <lng>" near the top, but verify the current page/schema.

After Step 2 confirms the official Esplanade radius, run the read-only audit:

```bash
python3 -m playa map-audit \
  --year "$YEAR" \
  --street-lines "/tmp/brc-$YEAR/street_lines.geojson" \
  --center "<GOLDEN_SPIKE_LAT>,<GOLDEN_SPIKE_LNG>" \
  --esplanade-radius-feet <OFFICIAL_RADIUS> \
  --output "/tmp/brc-$YEAR/map-audit.json"
```

Review the reported schema, digest, bounds, excluded non-grid roads, candidate
radii, and every radial start. The command never edits `data.ts` and is not a
normal build dependency.

## Step 2 — extract measurements

`pdftotext -layout /tmp/brc-$YEAR/measurements.pdf -` usually works.
You're looking for:

- **Man coords** (sanity-check vs. the Innovate page)
- **True N/S axis** — the document may say something like "True
  North/South follows the 4:30 axis". That identifies a line, not which
  outward direction is north; the opposite direction on the same line is
  10:30. Never derive `twelveBearingDeg` from that sentence alone. Use the
  official GIS CPN coordinates to disambiguate: the Temple/12:00 anchor should
  project northeast, the 3:00 and 9:00 stations should land on their named
  sides, and the Center Camp/6:00 anchors should project southwest. For 2025
  and 2026 this yields a 12:00 bearing of about 45°.
- **Esplanade radius** (the line "The center of the first road
  'Esplanade' is X' from the Man")
- **Block depths** (the paragraph starting "Esplanade to [A-street] is
  … deep")
- **Street widths** (usually 40', Kraken/K-street 50')
- **Fence pentagon vertices** (the five "Point N" bullets at the top)

The PDF's block depths are clear distances between street edges, not radial
center-to-center deltas. For each adjacent pair calculate:

```text
next centerline = prior centerline
                + prior street width / 2
                + clear block depth
                + next street width / 2
```

Then verify the resulting radii against distances from the Golden Spike to
several vertices on each named annular feature in `street_lines.geojson`. This
cross-check is required: omitting half-widths pulled the old 2025/2026 K arc
355 feet inward while still producing a visually plausible map.

If `pdftotext` returns scrambled output (happens with heavy PDFs), fall
back to `pdftotext -layout -raw` or ask the user to copy the text from
Preview.

## Step 3 — extract street labels

`pdftotext -layout /tmp/brc-$YEAR/plan.pdf -` gives you the labels in
arbitrary order. The important ones to confirm:

- Themed names for Esplanade + A–K (or however many letters this
  year's plan uses). The city plan page #1 narrates these in prose.
- Radial clock positions — sort `pdftotext` output and filter
  `grep -E '^\d+:\d+$' | sort -u`. Confirm whether the outer blocks
  use 15-minute interstitials (2:15, 2:45, 8:45, etc.), then compare this
  list with `map-audit`'s 2:00–10:00 candidates.
- Radial inner endpoints — group the official `street_lines.geojson` features
  by clock name and review `map-audit`'s ring-intersection result. Do not use
  raw minimum distance alone: 3:00/6:00/9:00 may contain center spurs. Do not
  assume every radial begins at Esplanade; in 2025/2026, quarter-hour streets
  begin at F.

## Step 4 — update `client/src/map/data.ts`

Make targeted edits — **don't rewrite the file from scratch** since
the rendering code reads the object in a specific shape.

Copy only the reviewed `streetRadiiFeet`, `streetLetters`, and
`radialStreets` candidates from `map-audit`. The Golden Spike,
`twelveBearingDeg`, themed `streetNames`, and fence vertices remain explicit
human-reviewed inputs.

```ts
const BRC_20YY: BrcMapData = {
  year: <YEAR>,
  center: { lat: <golden_spike_lat>, lng: <golden_spike_lng> },
  twelveBearingDeg: <computed bearing — see Step 2>,
  streetRadiiFeet: [
    <esplanade>,      // Esplanade
    <a-centerline>,   // A — include half-widths around the clear block
    // … one entry per letter, running from inside out
  ],
  streetLetters: ['Esplanade', 'A', 'B', ..., 'K'],
  streetNames:   ['Esplanade', '<themed A>', '<themed B>', ...],
  radialStreets: [
    { clock: '2:00', innerStreet: 'Esplanade' },
    { clock: '2:15', innerStreet: 'F' }, // derive each range from street_lines
    // … through 10:00
  ],
  fencePentagon: [
    { lat: …, lng: … },  // Point 1
    // … five entries
  ],
};

export const BRC_BY_YEAR: Record<number, BrcMapData> = {
  // Keep every existing historical entry.
  20YY: BRC_20YY,
};

// Bump with BRC_MAP_YEAR. If BRC_20YY is not registered yet, the source remains
// usable and its Map tab explicitly stays unavailable.
export const CURRENT_BRC_YEAR = 20YY;
```

Also update the top-of-file comment block — especially the
**"Last refreshed: YYYY-MM-DD"** line and the source URLs.

## Step 4b — update GIS overlays and year configuration

Follow the runbook's POI audit before changing `POI_RULES`. Preserve
stable IDs, add reviewed annual source-name aliases, keep medical/
Rangers/Temple in `base`, ice in `essentials`, and all toilet banks in
the dedicated default-off `toilets` layer. Inspect `plazas.geojson` as well as
CPNs/toilets: preserve the annual Center Camp Plaza Polygon/MultiPolygon in
`AREA_RULES`, keep its stable `poi_id` link to `center-camp`, and accept only
reviewed property-name aliases (2025 uses `Name`; 2026 uses `name`). Never copy
a prior year's footprint when the current file is unavailable. Then regenerate
instead of reusing the old cache:

```bash
python3 -m playa gis-fetch --year "$YEAR" --force
```

The burn window has **no code default**. Set the official dates in local
`.env` and GitHub repository variables `BURN_WINDOW_OPEN_FROM` and
`BURN_WINDOW_OPEN_TO`. Also align `BRC_MAP_YEAR`, `BM_API_YEARS`, the
workflow/config map-year fallbacks, and `SITE_TIERS` source lists when a
new API source is enabled. Never copy last year's dates into Python.

## Step 5 — sanity-check the math before committing

Run a small script against known addresses to confirm pins land where
a human would expect:

```bash
cd client
npx tsx -e '
  import { addressToLatLng, parseAddress } from "./src/map/address";
  import { getBrcForYear } from "./src/map/data";
  const brc = getBrcForYear(Number(process.env.YEAR));
  if (!brc) throw new Error(`No exact geometry for ${process.env.YEAR}`);
  for (const addr of ["6:00 & Esplanade", "9:00 & K", "4:30 & F"]) {
    console.log(addr, "→", addressToLatLng(addr, brc), parseAddress(addr, brc));
  }
'
```

Cross-check against `maps.google.com/?q=<lat>,<lng>` — you should see:
- "6:00 & Esplanade" lands on the BRC 6:00 axis close to the Man
- "9:00 & K" lands on the outer ring to the northwest
- Everything stays inside the fence pentagon

## Step 6 — test + build

```bash
make test
cd client && npm run typecheck && npm run build && cd ..
make rebuild
git diff --check
```

Then complete `docs/dev/mobile-visual-testing.md`, including every layer,
the full fence, default-off Toilets, POI tap labels/details, and final
encrypted-build restoration.

## Step 7 — commit with a clear message

Use a user-facing release-note commit after reviewing the complete diff:

```
git commit -m "rn: update the map and official service locations for 20YY"
```

## Hard rules

- **Never touch rendering code** (`MapView.tsx`, `address.ts`) in this
  skill. It's year-stable. If layout fundamentally changes (BM goes
  elliptical, stops using the clock grid), stop and surface it to the
  user — don't try to rewrite.
- **Never fabricate coordinates.** If the measurements PDF hasn't
  landed yet for the new year, say so. The new data source may stay active with
  an unavailable Map tab; do not combine a new Golden Spike with last year's
  fence or borrow another `BRC_BY_YEAR` entry.
- **Don't drop historical data.** Add a new `BRC_BY_YEAR` entry and keep
  every previous entry because past `api-YYYY` sources still use them.

## Known gotchas

- The **measurements PDF** sometimes 403s to curl. Use a real
  `User-Agent` header, or tell the user to download it in a browser
  and point the skill at the local file.
- **Fence coordinates** release later than the Golden Spike (usually
  mid-July). When the Spike has moved but the fence has not been
  re-published, keep the geometry entry in draft. The source can be active with
  no map. A last-year fence translated around a new Spike is not an acceptable
  production estimate.
- The **city plan PDF** has its labels spatially arranged, so
  `pdftotext` reorders them randomly. Don't trust the ordering — only
  trust the presence/absence of each label.
- If a theme is controversial and official communications conflict about
  street names, fall back to letter names (A–K) — the rendering code
  uses letters primarily, names are decorative.
