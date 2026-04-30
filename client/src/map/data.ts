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
  kind: 'center-camp' | 'playa-info' | 'ranger' | 'medical' | 'toilets' | 'other';
  address: string;
  description?: string;
}

/**
 * Curated, year-stable points of interest. Only entries we can verify
 * against primary sources live here — the full GIS set (rangers,
 * medical, individual porto banks) lives in the official Innovate
 * GIS dataset and should be pulled in via the /update-map skill when
 * it refreshes for a new burn year.
 *
 * Sources for the entries below (both stable across years):
 *   - Center Camp: BRC's literal center, at the 6:00 & Esplanade axis
 *     (the `6:00 axis` is named for this; see Legend modal / city plan).
 *   - Playa Info: `https://burningman.org/black-rock-city/preparation/
 *     infrastructure/playa-info/` states "Esplanade and 5:45".
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
  // TODO: rangers / medical (Rampart) / porto banks — load from
  // github.com/burningmantech/innovate-GIS-data via the /update-map
  // skill's annual refresh step (those locations shift year to year).
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
  // Fence vertices carried over from 2023 as a visual-only baseline.
  // Real 2026 fence coordinates release mid-July; skill refreshes then.
  fencePentagon: [
    { lat: 40.782814, lng: -119.233566 },
    { lat: 40.807028, lng: -119.217274 },
    { lat: 40.802722, lng: -119.181931 },
    { lat: 40.775857, lng: -119.176407 },
    { lat: 40.763558, lng: -119.208301 },
  ],
};

/**
 * Per-year BRC geometry. New years are appended by the `/update-map`
 * skill; old entries stay in place forever (~200 bytes each, harmless,
 * still used when the user picks a past-year API source).
 *
 * **2025 NOT YET BACKFILLED** — placeholder using 2026 numbers.
 * `parseAddress` against a 2025 camp address will currently use 2026
 * geometry, which can be off by a block where depths shifted (and will
 * fail outright if the camp's letter is in 2025's street set but not
 * 2026's, e.g., an `L`-street address). Run `/update-map 2025` to
 * fetch the real 2025 city plan before relying on `api-2025` mapping.
 */
export const BRC_BY_YEAR: Record<number, BrcMapData> = {
  2026: BRC_2026,
  // 2025: TODO — backfill via /update-map skill from
  //   https://innovate.burningman.org/dataset/2025-golden-spike-and-general-city-map-data/
  //   (KML for Golden Spike) plus burningmantech/innovate-GIS-data on GH
  //   for radii / letter set / fence. Until then we fall back to 2026
  //   below.
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
