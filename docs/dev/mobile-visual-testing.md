---
title: Mobile Visual Testing Runbook
date: 2026-08-07
status: current
---

# Mobile Visual Testing Runbook

## Purpose

Use this runbook whenever a change affects responsive layout, touch controls,
maps, modals, tabs, cards, or other mobile-visible behavior. Unit tests and
TypeScript checks catch logic errors, but they do not show clipping, crowded
controls, unreadable SVG details, accidental page overflow, or service-worker
staleness.

The baseline phone viewport is **390 × 844 CSS pixels** (roughly an iPhone
12/13/14). Also spot-check 360 × 800 and 430 × 932 when a change is sensitive
to horizontal space.

## What was done for the 2026 GIS-map change

The August 6, 2026 map review used this sequence:

1. Ran the Python and client test suites, TypeScript checking, and the client
   bundle build.
2. Ran `make rebuild` and confirmed the normal tiered/encrypted site built with
   one embedded 2026 GIS payload.
3. Temporarily built a directory-only plaintext site so headless automation did
   not need a production password or place a password in a script or process
   argument.
4. Served `site/` on **loopback only** at `127.0.0.1:8765`.
5. Started headless Chrome with a new profile under `/tmp`, a 390 × 844 window,
   and a loopback-only Chrome DevTools Protocol (CDP) port.
6. Through CDP, selected the `#map` route, applied mobile device metrics,
   scrolled the map controls into view, and captured a screenshot.
7. Selected the official 3:00 Medical/ESD marker, scrolled the SVG into view,
   and captured the selected-marker state.
8. Inspected both screenshots locally. This verified the horizontally
   scrollable layer pills, control wrapping, selected POI card, click label,
   official fence extent, toilet-bank density, and map rendering.
9. Stopped both processes, deleted the temporary Chrome profile and screenshots,
   rebuilt the normal encrypted site, and asserted that no plaintext camp
   payload remained.

Screenshots from a plaintext or unlocked build can contain protected event
information. They were deliberately temporary and were not added to the repo.

### Follow-up review: compact Boundary and overlapping arrival markers

The same 390 × 844 isolated-profile procedure was repeated after making the
trash fence a default-off Boundary layer and changing clustered POI hit
resolution:

1. With Boundary off, the SVG reported a 12,000-foot-wide `viewBox`, rendered
   no `.brc-trash-fence`, and the document had no horizontal overflow. The city
   grid occupied the useful width of the phone screenshot.
2. Enabling Boundary rendered the complete fence and expanded the `viewBox` to
   about 17,990 feet. Turning it back off removed the fence and restored the
   compact extent.
3. In that intermediate revision, enabling Arrival alone did not expand the
   overview; selecting Main Gate reframed it. The later explicit-layer fitting
   review below supersedes that behavior because enabled off-city markers must
   not remain clipped.
4. The Gate / Box Office / Will Call overlap has a focused DOM regression test
   that sends the click to the later-rendered Box Office group at the orange
   Main Gate centroid. The result must select Main Gate, proving pointer taps
   are resolved by nearest visible centroid rather than DOM paint order.
5. The temporary screenshots/profile were deleted and the encrypted build was
   restored using the mandatory procedure below.

### Follow-up review: official GIS orientation

The 390 × 844 isolated-profile procedure was repeated after correcting the
direction of the annual city axis. This check used official 2026 GIS points as
directional anchors rather than relying on the undirected north/south axis in
the Measurements dataset:

1. Center Camp Plaza rendered below the Man near 6:00, and Arctica Ice —
   Center Camp rendered below and slightly toward 6:15. Both official points
   are inside the A–B block; nearest-centerline reverse lookup reports A.
2. Medical / ESD — 3:00 rendered on the right/east side of the city, while
   Medical / ESD — 9:00 rendered on the left/west side.
3. Selecting Center Camp Arctica activated the same marker and list row, kept
   the compact `-6000 -3300 12000 9300` viewBox, and showed no document-level
   horizontal overflow.
4. The temporary screenshot/profile were deleted and the tiered encrypted
   production build was restored.

Repeat these anchor assertions every year. A north/south line alone does not
identify which end is 12:00; use at least one known 12:00/6:00 point and both
3:00/9:00 points from that year's official GIS release.

### Follow-up review: Center Camp footprint and explicit layer fitting

The 390 × 844 isolated-profile procedure was repeated with the real normalized
2026 `plazas.geojson`, CPN, toilet, and fence data on 2026-08-07:

1. The compact default remained `-6000 -3300 12000 9300`, with zero
   document-level horizontal overflow.
2. Center Camp rendered as the official roughly 520 × 520-foot annual plaza
   footprint on the 6:00 side. Tapping the polygon selected the existing
   `Center Camp Plaza` row; it did not create a duplicate landmark.
3. Arrival was enabled after zooming in twice. The control reset to the fitted
   1× overview (`20,817` feet wide), and Gate, Greeters, Box Office, and Will
   Call were all inside the viewBox. Disabling Arrival restored 12,000 feet.
4. Transport fitted to `18,006` feet with both Burner Express Bus Depot and the
   Airport inside the viewBox, then restored the compact extent when disabled.
5. Boundary fitted to `17,990` feet with the complete fence inside the viewBox,
   then restored the compact extent when disabled.
6. Screenshots for Center Camp, Arrival, Transport, and Boundary were inspected
   locally. The temporary profile/screenshots were deleted, and the normal
   tiered encrypted build was restored using the procedure below.

### Follow-up review: official letter arcs and quarter-hour radials

The same isolated 390 × 844 review was repeated on 2026-08-07 after replacing
the accumulated block-depth radii with official street centerlines:

1. The default `viewBox` remained `-6000 -3300 12000 9300`; the city did not
   shrink, and `document.documentElement.scrollWidth === innerWidth === 390`.
2. The rendered Esplanade–K radii were
   `2500, 2935, 3215, 3495, 3775, 4060, 4545, 4825, 5105, 5385, 5565, 5755`
   feet, matching the nominal centerlines independently measured from both the
   2025 and 2026 official `street_lines.geojson` exports.
3. The SVG contained 33 annual radials. The 6:15 line began at F (4,545 feet),
   while 6:30 began at Esplanade (2,500 feet), matching the official outer-only
   quarter-hour pattern.
4. The corrected K radius exposed clipping in the original 350-foot cardinal
   hour-label offset. After adjustment, 3:00, 6:00, and 9:00 sat at radius
   5,855 feet inside the compact frame; 10:00 retained a 300-foot offset and
   remained separate from the K letter label.
5. The official Center Camp polygon spanned roughly 2,738–3,258 feet from the
   Man, crossing the Esplanade/A/B area as the source geometry specifies. The
   CPN point remained at about 3,026 feet, inside that footprint.
6. Default and 2.25× screenshots were inspected locally. The final screenshot,
   temporary profile, and plaintext build were removed/restored using the
   mandatory procedure below.

### Follow-up review: sticky map controls

The 390 × 844 isolated-profile review was repeated after making the map control
panel sticky on 2026-08-07:

1. The live `.site-chrome` measured 254.234 CSS pixels in the test state. The
   map panel's top edge remained at 253.234 pixels while the page was scrolled,
   giving the intended one-pixel overlap instead of a gap or hidden controls.
2. The 182.875-pixel panel kept the map title, zoom/unit/legend/GPS actions,
   and horizontally scrollable layer row visible while the 280.547-pixel SVG
   remained visible beneath it.
3. Toilets was toggled from the stuck panel. Its `aria-pressed` state changed
   from false to true and all 45 official toilet markers appeared without the
   panel moving.
4. The document remained exactly 390 CSS pixels wide with no horizontal page
   overflow; only the intended layer-pill row scrolls horizontally.
5. The screenshot was inspected locally. The temporary plaintext screenshot,
   Chrome profile, and server were removed, then the tiered encrypted build was
   restored using the mandatory procedure below.

### Follow-up review: marker silhouette vocabulary

The isolated-profile review was repeated at 390 × 844 and 1440 × 1000 on
2026-08-07 after replacing the map's mostly circular marker vocabulary:

1. The default mobile view remained exactly 390 CSS pixels wide with no page
   overflow. The sticky control panel stayed at 253.234 pixels while the map
   remained visible beneath it.
2. At overview and 225% zoom, Ranger shields were visibly different from the
   Temple diamond; Playa Info's square differed from Arctica's hexagon; and
   Medical retained a red octagon/cross combination. Shapes remained visible
   even where the tiny glyph could not be read.
3. A real directory camp was temporarily set as home, another was starred, and
   a meet spot was inserted into isolated-profile storage. DOM and screenshots
   confirmed the tent with doorway, bookmark with star, and rendezvous marker
   rendered as separate silhouettes. A home camp that was also starred did not
   receive a second bookmark underneath its tent.
4. The desktop overview contained circle, square, diamond, triangle, hexagon,
   pentagon, octagon, shield, and capsule POI families without horizontal
   overflow. Selected-state halos did not change the marker's base silhouette.
5. The generated screenshots contained directory data, so they were inspected
   locally and deleted with the isolated Chrome profile. The normal encrypted
   artifact was restored afterward.

The same phone profile was used after replacing The Man's center dot with an
SVG effigy. At 225% map zoom the complete outlined marker occupied about
19.5 CSS pixels, its head/body/arms/legs remained distinguishable, the label
did not collide with the head, and the Golden Spike group remained
untransformed at SVG `(0, 0)`. The viewport and document widths both remained
390 CSS pixels. The temporary plaintext screenshots/profile were deleted and
the encrypted artifact was restored as usual.

## Required automated checks

Run these first so visual review is focused on presentation rather than known
logic failures:

```bash
make test
cd client && npm run typecheck && npm run build
```

For map work, the focused tests are:

```bash
cd client
node --test --import tsx tests/gis.test.ts tests/MapView.test.ts
cd ..
python3 -m unittest backend.tests.test_gis backend.tests.test_mapaudit -v
```

## Recommended manual review

For most UI work, this is the simplest and most representative path:

1. Build and serve the normal app:

   ```bash
   make rebuild
   python3 -m http.server 8765 --bind 127.0.0.1 --directory site
   ```

2. Open `http://127.0.0.1:8765/` in a private/incognito browser window. Unlock
   with the intended test tier.
3. Open browser developer tools, enable responsive-device mode, and set the
   viewport to 390 × 844.
4. Test real taps/clicks, horizontal scrolling, keyboard focus, modal closing,
   both orientations when relevant, and at least one light and one dark theme.
5. Repeat source-sensitive surfaces with both a directory-capable password and
   an API-only password. This catches source-specific labels and disclaimers.

The server reads files from `site/` on each request, so it normally does not
need restarting after a rebuild. The service worker may still serve an older
shell. Use the app's **Force refresh**, clear site data, or use a fresh private
profile before concluding that a visual change is missing.

Never omit `--bind 127.0.0.1`. A plaintext or unlocked build must not be served
on every network interface.

## Reproducible headless screenshot review

Use this when screenshots are useful for comparison or no interactive browser
is available.

### 1. Preserve the production-shaped result

Build normally first and note the reported encryption mode and GIS years:

```bash
make rebuild
```

### 2. Optionally create a temporary plaintext review build

This is only for local automation that cannot pass through the password gate.
It overwrites the generated `site/index.html`, so restoration is mandatory:

```bash
SITE_PASSWORD= SITE_TIERS= BM_API_YEARS= \
  BURN_WINDOW_OPEN_FROM=2026-08-30 \
  BURN_WINDOW_OPEN_TO=2026-09-07 \
  CAMP_LOCATION_RELEASE_AT=2026-08-23T00:00:00-07:00 \
  ART_LOCATION_RELEASE_AT=2026-08-30T00:00:00-07:00 \
  python3 -m playa build --sources directory
```

Use the active year's real burn-window values when available. Do not change or
commit `.env` merely to make this temporary build.

### 3. Start loopback-only services

In one terminal:

```bash
python3 -m http.server 8765 --bind 127.0.0.1 --directory site
```

On macOS, start an isolated headless Chrome in another terminal:

```bash
MOBILE_REVIEW_DIR="$(mktemp -d /tmp/playa-mobile-review.XXXXXX)"

"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new \
  --disable-gpu \
  --disable-extensions \
  --disable-background-networking \
  --no-first-run \
  --no-default-browser-check \
  --user-data-dir="$MOBILE_REVIEW_DIR/profile" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9223 \
  --window-size=390,844 \
  http://127.0.0.1:8765/
```

Keep that process running. On Linux, substitute the installed Chromium/Chrome
binary. The isolated profile prevents an older service worker or ordinary
browser state from contaminating the result.

### 4. Drive the page through CDP

Query `http://127.0.0.1:9223/json/list`, select the entry whose URL starts with
`http://127.0.0.1:8765/`, and connect to its `webSocketDebuggerUrl`. Node 22+
provides the required `fetch` and `WebSocket` globals.

The screenshot helper used during the 2026 review performed these CDP calls:

1. `Page.enable` and `Runtime.enable`.
2. `Emulation.setDeviceMetricsOverride` with width `390`, height `844`, device
   scale factor `1`, and `mobile: true`.
3. `Runtime.evaluate` with `location.hash = '#map'`.
4. Scroll `.map-head` into view and call `Page.captureScreenshot` for the map
   controls and layer row.
5. Dispatch a bubbling click on `.brc-poi-medical`, scroll `.brc-svg` into
   view, and capture the selected-marker state.
6. Decode each returned base64 PNG into the temporary review directory.

For other features, change only the route, selector, and scroll target. Keep
the viewport and clean-profile setup stable so screenshots are comparable.

## Mobile inspection checklist

- The overall document does not horizontally overflow. Intentional horizontal
  scrollers—tabs, tag chips, and map-layer pills—remain finger-scrollable.
- Primary mobile controls are at least approximately 44 CSS pixels tall or
  have an equivalent enlarged hit area.
- Text is not clipped at 200% browser zoom and long labels wrap sensibly.
- Fixed or sticky chrome does not cover the content being navigated to.
- Light and dark themes maintain contrast for borders, labels, icons, selected
  states, and disabled controls.
- Modals fit the viewport, scroll internally, and close by button, backdrop,
  and Escape where supported.
- The default map keeps the city grid large with Boundary off. Enabling
  Boundary shows the complete trash fence and expands the viewBox; disabling it
  restores the compact extent. Zoom and pan work in both states.
- Map categories remain distinguishable by glyph/shape as well as color.
- Specifically compare Ranger vs Temple, Playa Info vs Arctica, and every
  personal family: home tent, camp bookmark, art star, meet marker, GPS
  bullseye, and unsaved-target crosshair. A home tent must supersede a favorite
  bookmark at the same coordinate rather than stacking both.
- A tapped POI shows its map label and selected list row, purpose text,
  location, distance/bearing/ETA state, and external-map link.
- Turning a map layer off removes its POIs and clears any now-hidden selection.
- Transport and Arrival do not shrink the default ambient overview. Explicitly
  enabling either fits all of that layer's distant markers and resets a close
  zoom; disabling it restores the compact extent. Selecting one POI can also
  reframe it. Tapping the Gate/Box Office/Will Call cluster selects the icon
  nearest the finger rather than a later-rendered neighbor.
- Center Camp uses the current year's official plaza footprint, and tapping the
  polygon delegates to the same details row as its point marker.
- The annual Esplanade–outer-street arcs follow the reviewed official
  centerline radii; outer arcs do not drift progressively inward. All official
  radial streets appear with the right inner endpoint, and the 3:00, 6:00,
  9:00, and 10:00 labels remain fully inside the compact phone viewBox.
- While scrolling the map, its control panel sticks directly below the global
  app chrome. Layer toggles remain operable with part of the SVG visible, and
  changing a layer visibly updates the map without requiring a scroll back up.
- Toilets are off on first load, can be enabled independently of Essentials,
  and remain tappable without permanent labels when enabled.
- A source whose geometry is not published yet shows its year-specific Map
  unavailable state with no SVG, layer controls, or borrowed coordinates;
  camps/events/art/schedules still render, Schedule Near-me is disabled, and
  every enabled historical source with exact geometry still has a working map.
- Exercise the current API year with at least one released camp location and a
  starred/home marker. Before upstream publishes locations, the committed
  `MapView.test.ts` fixture is the required regression; do not borrow another
  year's coordinates or weaken the test because production fields are blank.
  Once raw locations exist, repeat manually with the trusted tier or after the
  configured embargo opens.
- Directory and API-only sources show the correct source-specific disclaimer.
- A refresh and an offline reload do not regress to a stale or incomplete shell.

## Mandatory restoration and cleanup

After any temporary plaintext review:

1. Stop the HTTP server and headless browser.
2. Restore the real encrypted build:

   ```bash
   make rebuild
   ```

3. Verify the generated artifact. Adjust source names if the configured build
   changes, but keep the same three assertions:

   ```bash
   python3 - <<'PY'
   import re
   from pathlib import Path

   html = Path("site/index.html").read_text()
   assert 'id="camps-data-directory-cipher"' in html
   assert 'id="camps-data-directory"' not in html
   match = re.search(
       r'<meta name="bm-directory-map-year" content="(\d{4})">',
       html,
   )
   assert match is not None
   year = match.group(1)
   assert html.count(f'id="gis-data-{year}"') == 1
   print(f"encrypted build restored; one {year} GIS payload embedded")
   PY
   ```

4. Inspect the temporary path before deleting it. Remove only the exact
   `playa-mobile-review.*` directory created by `mktemp`; never use a broad
   `/tmp/*` glob. Delete screenshots once the review is complete unless they
   have been explicitly scrubbed and approved for long-term documentation.
5. Run `git status --short` and confirm that no browser profile, screenshot,
   fetched GIS cache, or generated site payload is staged for commit.

## Code references

- `client/src/components/MapView.tsx`
- `client/src/components/MapInfoModal.tsx`
- `client/src/map/gis.ts`
- `backend/src/playa/templates/site.html`
- `backend/src/playa/builder.py`
- `client/tests/MapView.test.ts`
- `client/tests/gis.test.ts`
- `backend/tests/test_gis.py`
