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
   * radial, looking outward from the Man. Current official GIS anchors place
   * 12:00 northeast at about 45° and 6:00 southwest at about 225°. Encoded
   * per year so a future layout can change the convention.
   */
  twelveBearingDeg: number;
  /** Concentric street radii from the Man, in feet. Parallel to `streetNames`. */
  streetRadiiFeet: number[];
  /** Street labels — `['Esplanade', 'A', 'B', ..., 'K']`. */
  streetLetters: string[];
  /** Display names (Esplanade + the year's themed names). */
  streetNames: string[];
  /** Radial streets in the occupied 2:00–10:00 arc. Quarter-hour streets
      begin at F; the other radials begin at Esplanade. */
  radialStreets: Array<{
    clock: string;
    innerStreet: string;
  }>;
  /** Trash-fence pentagon vertices in decimal degrees. Used to clip the
      map view and compute off-playa detection. */
  fencePentagon: Array<{ lat: number; lng: number }>;
}

/** A static point-of-interest for the map layer (Center Camp, Playa
 *  Info, medical, ranger HQ, portos). `address` uses the same grammar
 *  as camp locations so `parseAddress` resolves it to a pin position.
 *  The `kind` is a thin categorization the renderer can key off for
 *  icon/color selection. */
export type PoiLayer =
  | 'base' | 'essentials' | 'toilets' | 'services' | 'transport' | 'arrival';

/** User-toggleable map overlays. `boundary` is geometry rather than a POI,
 * so it stays out of `BrcPOI.layer` while sharing the persisted layer UI. */
export type MapLayer = PoiLayer | 'boundary';

export type PoiKind =
  | 'center-camp' | 'playa-info' | 'plaza' | 'other'
  | 'medical' | 'ranger' | 'ice' | 'temple' | 'toilet' | 'info'
  | 'art-services' | 'recycle' | 'bike' | 'bus' | 'airport'
  | 'dmv' | 'media' | 'greeters' | 'gate' | 'box-office' | 'will-call';

export interface BrcPOI {
  /** Stable within a map year. Official GIS ids are semantic slugs. */
  id: string;
  name: string;
  kind: PoiKind;
  layer: PoiLayer;
  address?: string;
  description?: string;
  /** Official points carry exact GPS coordinates. Legacy POIs use address. */
  lat?: number;
  lng?: number;
  source_name?: string;
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
    id: 'center-camp',
    name: 'Center Camp Plaza',
    kind: 'center-camp',
    layer: 'base',
    address: '6:00 & B',
    description: 'The Canopy and Center Camp community hub.',
  },
  {
    id: 'playa-info-fallback',
    name: 'Playa Info',
    kind: 'playa-info',
    layer: 'base',
    address: '5:45 & Esplanade',
    description:
      'Lost & found, camp lookup, message board. Open 9am–6pm daily + some evenings mid-week.',
  },
  {
    id: 'plaza-3-b', name: '3:00 & B Plaza', kind: 'plaza', layer: 'base', address: '3:00 & B',
    description: 'Inner-city plaza near 3:00 keyhole.',
  },
  {
    id: 'plaza-9-b', name: '9:00 & B Plaza', kind: 'plaza', layer: 'base', address: '9:00 & B',
    description: 'Inner-city plaza near 9:00 keyhole.',
  },
  {
    id: 'plaza-3-g', name: '3:00 & G Plaza', kind: 'plaza', layer: 'base', address: '3:00 & G',
    description: 'Mid-city plaza on the 3:00 axis.',
  },
  {
    id: 'plaza-9-g', name: '9:00 & G Plaza', kind: 'plaza', layer: 'base', address: '9:00 & G',
    description: 'Mid-city plaza on the 9:00 axis.',
  },
  {
    id: 'plaza-6-g', name: '6:00 & G Plaza', kind: 'plaza', layer: 'base', address: '6:00 & G',
    description: 'Mid-city plaza behind Center Camp on the 6:00 axis.',
  },
  {
    id: 'plaza-430-g', name: '4:30 & G Plaza', kind: 'plaza', layer: 'base', address: '4:30 & G',
    description: 'Mid-city plaza on the 4:30 radial.',
  },
  {
    id: 'plaza-730-g', name: '7:30 & G Plaza', kind: 'plaza', layer: 'base', address: '7:30 & G',
    description: 'Mid-city plaza on the 7:30 radial.',
  },
];

/**
 * 2026 BRC, theme "Axis Mundi". Official street centerline radii from
 * `street_lines.geojson`, cross-checked against the 2026 Measurements PDF.
 * Center-to-center spacing includes the clear block depth plus half the
 * width of each bordering street:
 *
 *   Esp→A: 20 + 400 + 15 = 435'
 *   A→B→C→D: 15 + 250 + 15 = 280' each
 *   D→E: 15 + 250 + 20 = 285'
 *   E→F: 20 + 450 + 15 = 485'
 *   F→G→H→I: 15 + 250 + 15 = 280' each
 *   I→J: 15 + 150 + 15 = 180'
 *   J→K: 15 + 150 + 25 = 190'
 */
const BRC_2026: BrcMapData = {
  year: 2026,
  center: { lat: 40.783242, lng: -119.207871 },
  twelveBearingDeg: 45,
  streetRadiiFeet: [
    2500,                          // Esplanade (40' wide)
    2935,                          // A  (+435)
    3215, 3495, 3775,              // B, C, D (+280 each)
    4060,                          // E  (+285; 40' wide)
    4545,                          // F  (+485, mid-city double block)
    4825, 5105, 5385,              // G, H, I (+280 each)
    5565, 5755,                    // J (+180), K (+190; 50' wide)
  ],
  streetLetters: [
    'Esplanade', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K',
  ],
  streetNames: [
    'Esplanade', 'Ararat', 'Bodhi', 'Chomolungma', 'Delphi', 'Eternal',
    'Fulcrum', 'Great Oak', 'Heiau', 'Iroko', 'Jiba', 'Kundalini',
  ],
  // Official street_lines.geojson: :00/:30 run Esplanade→K;
  // :15/:45 are outer-city streets from F→K.
  radialStreets: Array.from({ length: 33 }, (_, index) => ({
    clock: `${2 + Math.floor(index / 4)}:${String((index % 4) * 15).padStart(2, '0')}`,
    innerStreet: index % 2 === 0 ? 'Esplanade' : 'F',
  })),
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
 * 2025 BRC, theme "Tomorrow Today" (sci-fi authors A→K). Official street
 * centerline radii match the 2026 layout described above. Golden Spike + fence pentagon
 * are 2025-specific (the city moved ~1,400 ft NE between 2025 and 2026).
 *
 * The centerline values deliberately include street widths. Do not rebuild
 * this array by adding only the clear block depths from the measurements PDF.
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
  twelveBearingDeg: 45,
  streetRadiiFeet: [
    2500,                          // Esplanade
    2935,                          // A  Atwood
    3215, 3495, 3775, 4060,        // B C D E
    4545,                          // F  Farmer (after mid-city double block)
    4825, 5105, 5385,              // G H I
    5565, 5755,                    // J K
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
  radialStreets: Array.from({ length: 33 }, (_, index) => ({
    clock: `${2 + Math.floor(index / 4)}:${String((index % 4) * 15).padStart(2, '0')}`,
    innerStreet: index % 2 === 0 ? 'Esplanade' : 'F',
  })),
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
 * Current BRC year used by source-independent defaults. Bumped by the
 * annual map-update workflow. Geometry may be
 * published later; until the matching `BRC_BY_YEAR` entry lands, source-aware
 * map consumers deliberately show an unavailable state.
 */
export const CURRENT_BRC_YEAR = 2026;

/** Resolve a year only when its exact geometry is present.
 *
 * Annual camp/API data and city geometry are released in stages. Returning a
 * different year's constants here would make a healthy source look usable
 * while placing every address at subtly wrong coordinates. Callers that render
 * source data must treat null as "map not available for this year yet". */
export function getBrcForYear(year: number): BrcMapData | null {
  return BRC_BY_YEAR[year] ?? null;
}

/**
 * Backward-compat default: code that doesn't yet know about per-year
 * geometry imports `BRC` and gets a known geometry object. Source-aware code
 * must use the nullable exact-year resolver instead; this compatibility export
 * must never be used to place records from an arbitrary source year.
 */
export const BRC: BrcMapData = BRC_BY_YEAR[CURRENT_BRC_YEAR] ?? BRC_2026;
