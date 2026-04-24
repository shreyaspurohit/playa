---
name: update-map
description: Refresh the BRC map constants in client/src/map/data.ts for a new burn year. Use when Burning Man has published the new year's city plan (usually April–June) or dataset (usually July), or when the user says "update the map for 2027" / "new year's map" / "the BRC plan is out".
---

# update-map

Each year Black Rock City's layout shifts: new center coordinates
("Golden Spike"), new axis-of-true-north, slightly different block
depths, a new set of themed street names, and a **new burn-week
calendar window** (e.g., 2026 = Sun Aug 30 → Mon Sep 7). This skill
pulls the year-specific numbers off the BM project's pages and
updates `client/src/map/data.ts` + `backend/src/playa/config.py` in
one pass.

**Nothing here can be fully automated** — Burning Man publishes some of
this as a PDF full of rendered graphics (not text), and the rest
arrives in a KML/GeoJSON that only opens mid-July. The skill walks
through what *can* be fetched, what has to be read by eye, and leaves
an auditable trail.

## When to run

- A new city plan page is linked from `burningman.org/black-rock-city/`
- The "Golden Spike and General City Map Data" dataset updates for a
  new year at `innovate.burningman.org/dataset/`
- The user says "update the map" / "new year's plan is out" / "bump
  the BRC map to 20YY"

## Inputs you need (human-readable URLs)

All of these get updated annually. Replace the year in the path.

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
YEAR=2027   # change me
mkdir -p /tmp/brc-$YEAR
curl -sS -L -A "Mozilla/5.0" "https://webassets.burningman.org/pdfs/BRC_City_Plan_${YEAR}_update.pdf" \
  -o /tmp/brc-$YEAR/plan.pdf
curl -sS -L -A "Mozilla/5.0" "https://webassets.burningman.org/pdfs/${YEAR}-brc-measurements.pdf" \
  -o /tmp/brc-$YEAR/measurements.pdf
```

`WebFetch` the Innovate dataset page directly (it's HTML):

```
innovate.burningman.org/dataset/<YEAR>-golden-spike-and-general-city-map-data/
```

Pull the Golden Spike coordinate from it — the page always formats it
as "<lat>, <lng>" near the top.

## Step 2 — extract measurements

`pdftotext -layout /tmp/brc-$YEAR/measurements.pdf -` usually works.
You're looking for:

- **Man coords** (sanity-check vs. the Innovate page)
- **True N/S axis** — the document will say something like "True
  North/South follows the 4:30 axis". **Bearing of BRC 12:00 =
  (360 − N × 30)°** where N is the clock hour of true north, taken
  counterclockwise on the BRC face. Example: True-N at 4:30 →
  BRC 12:00 bearing = 360 − 4.5·30 = 225°.
- **Esplanade radius** (the line "The center of the first road
  'Esplanade' is X' from the Man")
- **Block depths** (the paragraph starting "Esplanade to [A-street] is
  … deep")
- **Street widths** (usually 40', Kraken/K-street 50')
- **Fence pentagon vertices** (the five "Point N" bullets at the top)

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
  use 15-minute interstitials (2:15, 2:45, 8:45, etc.).

## Step 4 — update `client/src/map/data.ts`

Make targeted edits — **don't rewrite the file from scratch** since
the rendering code reads the object in a specific shape.

```ts
export const BRC: BrcMapData = {
  year: <YEAR>,
  center: { lat: <golden_spike_lat>, lng: <golden_spike_lng> },
  twelveBearingDeg: <computed bearing — see Step 2>,
  streetRadiiFeet: [
    <esplanade>,      // Esplanade
    <esplanade+400>,  // A  (or whatever the year's depth is)
    // … one entry per letter, running from inside out
  ],
  streetLetters: ['Esplanade', 'A', 'B', ..., 'K'],
  streetNames:   ['Esplanade', '<themed A>', '<themed B>', ...],
  radialClockPositions: [
    '2:00', '2:15', ...  // filter from Step 3
  ],
  fencePentagon: [
    { lat: …, lng: … },  // Point 1
    // … five entries
  ],
};
```

Also update the top-of-file comment block — especially the
**"Last refreshed: YYYY-MM-DD"** line and the source URLs.

## Step 4b — update burn-week dates

`backend/src/playa/config.py` holds the canonical burn window that
drives the schedule view's column dates and every event card's date
label. Update both defaults AND the fallback in `Config.from_env`:

```python
burn_start: str = "YYYY-MM-DD"   # opening Sunday (gates open)
burn_end:   str = "YYYY-MM-DD"   # closing Monday (exodus)
# …
burn_start=os.environ.get("BURN_START", "YYYY-MM-DD").strip(),
burn_end=os.environ.get("BURN_END",   "YYYY-MM-DD").strip(),
```

Source: input #5 in the list above. The ticketing page is the
authoritative word — the directory's per-event `(M/D)` tuples
sometimes lag a year behind and can't be trusted. These dates feed
the `canonical_week_map()` function in `timeparser.py`, which
overrides any stale fetched dates at build time.

## Step 5 — sanity-check the math before committing

Run a small script against known addresses to confirm pins land where
a human would expect:

```bash
cd client
npx tsx -e '
  import { addressToLatLng, parseAddress } from "./src/map/address";
  for (const addr of ["6:00 & Esplanade", "9:00 & K", "4:30 & F"]) {
    console.log(addr, "→", addressToLatLng(addr), parseAddress(addr));
  }
'
```

Cross-check against `maps.google.com/?q=<lat>,<lng>` — you should see:
- "6:00 & Esplanade" lands on the BRC 6:00 axis close to the Man
- "9:00 & K" lands on the outer ring to the northwest
- Everything stays inside the fence pentagon

## Step 6 — test + build

```bash
cd ~/personal-code/bm-camps
make test-js       # none of the existing tests hardcode year, they should pass
cd client && npm run build && cd ..
python3 -m playa build
open site/index.html
# spot-check: Map tab renders, your starred camps land on reasonable
# locations, the "use my GPS" button works
```

## Step 7 — commit with a clear message

```
git add client/src/map/data.ts backend/src/playa/config.py
git commit -m "map + burn dates: refresh for 20YY"
```

## Hard rules

- **Never touch rendering code** (`MapView.tsx`, `address.ts`) in this
  skill. It's year-stable. If layout fundamentally changes (BM goes
  elliptical, stops using the clock grid), stop and surface it to the
  user — don't try to rewrite.
- **Never fabricate coordinates.** If the measurements PDF hasn't
  landed yet for the new year, say so. Leave last year's numbers in
  place and note the discrepancy in the file comment.
- **Don't drop historical data.** Previous years' street names were
  real — if someone wants them back they can git-blame. Just
  overwrite; the file is the current year's truth.

## Known gotchas

- The **measurements PDF** sometimes 403s to curl. Use a real
  `User-Agent` header, or tell the user to download it in a browser
  and point the skill at the local file.
- **Fence coordinates** release later than the Golden Spike (usually
  mid-July). When the Spike has moved but the fence hasn't been
  re-published, keep the previous year's pentagon and note
  "fence not yet refreshed — estimate" in the file comment.
- The **city plan PDF** has its labels spatially arranged, so
  `pdftotext` reorders them randomly. Don't trust the ordering — only
  trust the presence/absence of each label.
- If a theme is controversial and the directory gets mixed up about
  street names, fall back to letter names (A–K) — the rendering code
  uses letters primarily, names are decorative.
