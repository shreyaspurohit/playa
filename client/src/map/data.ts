// Black Rock City geometry. All year-specific numbers live here so the
// `/update-map` Claude skill can refresh them annually without touching
// rendering code.
//
// Multi-year support (ADR D11): `BRC_BY_YEAR` is the year → constants
// map. Each year's geometry lives independently; addresses from a 2025
// API source are rendered with 2025's Golden Spike + radii, addresses
// from 2026 with 2026's, etc. Themed street names are NOT carried per
// year — never displayed (the UI labels with the letter only).
//
// Sources per year:
//   2026: https://innovate.burningman.org/dataset/2026-golden-spike-and-general-city-map-data/
//   2025: https://innovate.burningman.org/dataset/2025-golden-spike-and-general-city-map-data/
//   (etc. — `/update-map` skill backfills via the GH innovate-GIS-data repo)

export interface BrcMapData {
  year: number;
  /** Golden Spike — Man coords in decimal degrees. */
  center: { lat: number; lng: number };
  /**
   * Compass bearing (degrees clockwise from True North) of the BRC 12:00
   * radial, looking outward from the Man. True North aligns with the
   * 4:30 axis (design constant since the city's earliest years), so
   * 12:00 bearing is always 360° − 4.5h × 30°/h = 225° (SW). Encoded
   * here for forward-compatibility in case a future year breaks the
   * convention; today every year sets it to 225.
   */
  twelveBearingDeg: number;
  /** Concentric street radii from the Man, in feet. Parallel to `streetNames`. */
  streetRadiiFeet: number[];
  /** Street labels — `['Esplanade', 'A', 'B', ..., 'K']`. */
  streetLetters: string[];
  /** Display names (Esplanade + the year's themed names). */
  streetNames: string[];
  /** Clock positions with a radial street (every 15min between 2:00 and 10:00
      for the outer arcs; inner streets drop most 15min positions). */
  radialClockPositions: string[];
  /** Trash-fence pentagon vertices in decimal degrees. Used to clip the
      map view and compute off-playa detection. */
  fencePentagon: Array<{ lat: number; lng: number }>;
}

/** A static point-of-interest for the map layer (Center Camp, Playa
 *  Info, medical, ranger HQ, portos). `address` uses the same grammar
 *  as camp locations so `parseAddress` resolves it to a pin position.
 *  The `kind` is a thin categorization the renderer can key off for
 *  icon/color selection. */
export interface BrcPOI {
  name: string;
  kind:
    | 'center-camp' | 'playa-info' | 'ranger' | 'medical' | 'toilets'
    | 'plaza' | 'other';
  address: string;
  description?: string;
}

/**
 * Curated points of interest. Only entries whose address form
 * (`<clock> & <street>`) is stable across years live here — the
 * yearly GIS dataset
 * (https://github.com/burningmantech/innovate-GIS-data, refreshed
 * mid-July ~5–6 weeks before gates) carries the full set including
 * positions that shift annually (medical/Rampart, individual porto
 * banks, ranger Stations 3/6/9, the airport).
 *
 * Sources:
 *   - Center Camp: BRC's literal center, at the 6:00 & Esplanade axis.
 *   - Playa Info: `https://burningman.org/black-rock-city/preparation/
 *     infrastructure/playa-info/` states "Esplanade and 5:45".
 *   - Plazas: from the 2025 GIS `cpns.geojson` — names like
 *     "3 & B Plaza" / "9 & G Plaza" map to the corresponding
 *     `<clock> & <letter>` address. The clock-and-street naming
 *     pattern is stable across years, so per-year geometry resolves
 *     them via `addressToSvgFeet` without a year-keyed coordinate
 *     list. The 4:30 & 7:30 G plazas are the "Grootslang plazas"
 *     defined by the wider E→F mid-city block.
 */
export const POIS: BrcPOI[] = [
  {
    name: 'Center Camp',
    kind: 'center-camp',
    address: '6:00 & Esplanade',
    description: 'Café, community hub, ice.',
  },
  {
    name: 'Playa Info',
    kind: 'playa-info',
    address: '5:45 & Esplanade',
    description:
      'Lost & found, camp lookup, message board. Open 9am–6pm daily + some evenings mid-week.',
  },
  {
    name: '3:00 & B Plaza', kind: 'plaza', address: '3:00 & B',
    description: 'Inner-city plaza near 3:00 keyhole.',
  },
  {
    name: '9:00 & B Plaza', kind: 'plaza', address: '9:00 & B',
    description: 'Inner-city plaza near 9:00 keyhole.',
  },
  {
    name: '3:00 & G Plaza', kind: 'plaza', address: '3:00 & G',
    description: 'Mid-city plaza on the 3:00 axis.',
  },
  {
    name: '9:00 & G Plaza', kind: 'plaza', address: '9:00 & G',
    description: 'Mid-city plaza on the 9:00 axis.',
  },
  {
    name: '6:00 & G Plaza', kind: 'plaza', address: '6:00 & G',
    description: 'Mid-city plaza behind Center Camp on the 6:00 axis.',
  },
  {
    name: '4:30 & G Plaza', kind: 'plaza', address: '4:30 & G',
    description: 'Mid-city plaza on the 4:30 radial.',
  },
  {
    name: '7:30 & G Plaza', kind: 'plaza', address: '7:30 & G',
    description: 'Mid-city plaza on the 7:30 radial.',
  },
];

/**
 * 2026 BRC, theme "Axis Mundi". Block depths per the 2023 BRC
 * Measurements PDF (layout pattern is stable year-to-year):
 *
 *   Esp→A: 400'     (wide entry block)
 *   A→B, B→C, C→D, D→E: 250' each
 *   E→F: 450'       (mid-city double block for Grootslang plazas)
 *   F→G, G→H, H→I: 250' each
 *   I→J, J→K: 150' each (narrower outer blocks)
 */
const BRC_2026: BrcMapData = {
  year: 2026,
  center: { lat: 40.783242, lng: -119.207871 },
  twelveBearingDeg: 225,
  streetRadiiFeet: [
    2500,                          // Esplanade
    2900,                          // A  (+400)
    3150, 3400, 3650, 3900,        // B, C, D, E  (+250 each)
    4350,                          // F  (+450, mid-city double)
    4600, 4850, 5100,              // G, H, I  (+250 each)
    5250, 5400,                    // J, K  (+150 each)
  ],
  streetLetters: [
    'Esplanade', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K',
  ],
  streetNames: [
    'Esplanade', 'Ararat', 'Bodhi', 'Chomolungma', 'Delphi', 'Eternal',
    'Fulcrum', 'Great Oak', 'Heiau', 'Iroko', 'Jiba', 'Kundalini',
  ],
  // Radial streets: every 30 minutes 2:00–10:00, plus the 15-minute
  // interstitials used in the outer blocks of the 2026 plan (see the PDF).
  radialClockPositions: [
    '2:00', '2:15', '2:30', '2:45',
    '3:00', '3:15', '3:30',
    '4:00', '4:30',
    '5:00', '5:30',
    '6:00', '6:30',
    '7:00', '7:30',
    '8:00', '8:30', '8:45',
    '9:00', '9:15', '9:30', '9:45',
    '10:00',
  ],
  // Trash-fence pentagon — official 2026 vertices from the
  // Measurements PDF (https://bm-innovate.s3.amazonaws.com/2026/
  // 2026%20BRC%20Measurements.pdf). The PDF labels the first vertex
  // without a "P1" tag but ordering matches P1-P5 from prior years.
  fencePentagon: [
    { lat: 40.779710, lng: -119.237421 }, // P1 (W)
    { lat: 40.803523, lng: -119.221409 }, // P2 (NW)
    { lat: 40.799290, lng: -119.186670 }, // P3 (NE)
    { lat: 40.772883, lng: -119.181237 }, // P4 (SE)
    { lat: 40.760786, lng: -119.212582 }, // P5 (S)
  ],
};

/**
 * 2025 BRC, theme "Tomorrow Today" (sci-fi authors A→K). Block depths
 * match the 2026 / 2023-baseline layout. Golden Spike + fence pentagon
 * are 2025-specific (the city moved ~1,400 ft NE between 2025 and 2026).
 *
 *   Esp→A: 400'     (wide entry block)
 *   A→B, B→C, C→D, D→E: 250' each
 *   E→F: 450'       (mid-city double for Ellison↔Farmer plazas)
 *   F→G, G→H, H→I: 250' each
 *   I→J, J→K: 150' each
 *
 * Sources:
 *   - Golden Spike + fence: 2025 BRC Measurements (S3 mirror — webassets
 *     CDN 403s to curl):
 *     https://bm-innovate.s3.amazonaws.com/2025/2025%20BRC%20Measurements.doc.pdf
 *   - Themed names: 2025 city plan / Survival Guide. Note: GIS spells
 *     it "Jemison" but author N.K. Jemisin's name is the source of
 *     truth — Survival Guide spelling wins.
 *   - Radial clock positions: 2025 GIS street_lines.geojson — every
 *     15-min position 2:00–10:00 has a radial (full radials at :00/:30,
 *     outer-block-only at :15/:45).
 */
const BRC_2025: BrcMapData = {
  year: 2025,
  center: { lat: 40.786958, lng: -119.202994 },
  twelveBearingDeg: 225,
  streetRadiiFeet: [
    2500,                          // Esplanade
    2900,                          // A  Atwood     (+400)
    3150, 3400, 3650, 3900,        // B C D E       (+250 each)
    4350,                          // F  Farmer     (+450, mid-city double)
    4600, 4850, 5100,              // G H I         (+250 each)
    5250, 5400,                    // J K           (+150 each)
  ],
  streetLetters: [
    'Esplanade', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K',
  ],
  streetNames: [
    'Esplanade', 'Atwood', 'Bradbury', 'Cherryh', 'Dick', 'Ellison',
    'Farmer', 'Gibson', 'Herbert', 'Ishiguro', 'Jemisin', 'Kilgore',
  ],
  // Every 15 minutes 2:00–10:00. :00 / :30 are full radials reaching
  // Esplanade; :15 / :45 are outer-block (Farmer–Kilgore) radials only.
  radialClockPositions: [
    '2:00', '2:15', '2:30', '2:45',
    '3:00', '3:15', '3:30', '3:45',
    '4:00', '4:15', '4:30', '4:45',
    '5:00', '5:15', '5:30', '5:45',
    '6:00', '6:15', '6:30', '6:45',
    '7:00', '7:15', '7:30', '7:45',
    '8:00', '8:15', '8:30', '8:45',
    '9:00', '9:15', '9:30', '9:45',
    '10:00',
  ],
  // Trash-fence pentagon — official P1–P5 from the 2025 measurements PDF.
  fencePentagon: [
    { lat: 40.783388, lng: -119.232725 }, // P1 (W)
    { lat: 40.807354, lng: -119.216621 }, // P2 (NW)
    { lat: 40.803107, lng: -119.181667 }, // P3 (NE)
    { lat: 40.776557, lng: -119.176181 }, // P4 (SE)
    { lat: 40.764363, lng: -119.207719 }, // P5 (S)
  ],
};

/**
 * Per-year BRC geometry. New years are appended by the `/update-map`
 * skill; old entries stay in place forever (~200 bytes each, harmless,
 * still used when the user picks a past-year API source).
 */
export const BRC_BY_YEAR: Record<number, BrcMapData> = {
  2025: BRC_2025,
  2026: BRC_2026,
};

/**
 * Year that the `directory` source represents. Bumped by the
 * `/update-map` skill alongside `BRC_BY_YEAR` whenever a new burn
 * year's plan is published. The directory scrape always reflects the
 * current pre-burn year, so this and the `BRC_BY_YEAR` head should
 * track the same value.
 */
export const DIRECTORY_YEAR = 2026;

/**
 * Resolve a year to its BRC constants. Falls back to the most recent
 * known year when `year` is missing from `BRC_BY_YEAR` (e.g., the user
 * has an `api-2027` source but `/update-map 2027` hasn't been run yet),
 * with a one-time `console.warn`. Caller should never end up with `null`.
 */
export function getBrcForYear(year: number): BrcMapData {
  const direct = BRC_BY_YEAR[year];
  if (direct) return direct;
  // Pick the highest known year as the fallback. For older missing
  // years (e.g., a future api-2024 added before backfill), this still
  // gives the user *something* to render — better than crashing.
  const known = Object.keys(BRC_BY_YEAR).map(Number).sort((a, b) => b - a);
  const fallback = known.length > 0 ? BRC_BY_YEAR[known[0]] : BRC_2026;
  if (typeof console !== 'undefined') {
    // One-line dev hint; production users won't hit this unless they're
    // on a build that's missing geometry for one of its embedded sources.
    console.warn(
      `[BRC_BY_YEAR] no entry for year ${year}; falling back to ${fallback.year}.`
      + ' Run /update-map for the missing year to remove this warning.',
    );
  }
  return fallback;
}

/**
 * Backward-compat default: code that doesn't yet know about per-year
 * geometry imports `BRC` and gets the directory-year entry. New code
 * that's source-aware should use `getBrcForYear(year)` /
 * `getBrcForSource(source)` (in hooks/useSource).
 */
export const BRC: BrcMapData = getBrcForYear(DIRECTORY_YEAR);
