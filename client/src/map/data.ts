// Black Rock City geometry. All year-specific numbers live here so the
// `/update-map` Claude skill can refresh them annually without touching
// rendering code.
//
// Sources (2026):
//   https://burningman.org/black-rock-city/black-rock-city-2026/2026-black-rock-city-plan/
//   https://innovate.burningman.org/dataset/2026-golden-spike-and-general-city-map-data/
//
// Last refreshed: 2026-04-23. When you refresh, bump `YEAR` + leave a
// dated entry in `backend/CHANGELOG_MAP.md` (created by the skill).

export interface BrcMapData {
  year: number;
  /** Golden Spike — Man coords in decimal degrees. */
  center: { lat: number; lng: number };
  /**
   * Compass bearing (degrees clockwise from True North) of the BRC 12:00
   * radial, looking outward from the Man. 2026: True North aligns with
   * the 4:30 axis, so 12:00 bearing = 360° − 4.5h × 30°/h = 225° (SW).
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
    description: 'Café, community hub, ice. The 6:00 axis is named for it.',
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
export const BRC: BrcMapData = {
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
