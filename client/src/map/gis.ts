// Year-keyed official GIS payload embedded by the Python builder. The browser
// never fetches GitHub at runtime, so these layers work on playa/offline.
import { decompressGzip } from '../utils/gzip';
import type { BrcPOI, MapLayer, PoiKind } from './data';

export interface GisToilet extends BrcPOI {
  kind: 'toilet';
  layer: 'toilets';
  rings: number[][][]; // GeoJSON [ring][point][lng,lat]
  source_class?: string | null;
}

export interface GisArea {
  id: string;
  name: string;
  source_name?: string;
  kind: PoiKind;
  layer: MapLayer;
  /** Stable POI whose existing row/details should open when this area is tapped. */
  poi_id: string;
  /** GeoJSON [polygon][ring][point][lng,lat]. */
  polygons: number[][][][];
}

export interface GisYearData {
  year: number;
  source: string;
  points: BrcPOI[];
  areas: GisArea[];
  toilets: GisToilet[];
}

export const EMPTY_GIS: GisYearData = {
  year: 0, source: '', points: [], areas: [], toilets: [],
};

export const OPTIONAL_MAP_LAYERS: ReadonlyArray<{
  id: Exclude<MapLayer, 'base'>;
  label: string;
  glyph: string;
}> = [
  { id: 'boundary', label: 'Boundary', glyph: '⬠' },
  { id: 'essentials', label: 'Essentials', glyph: '❄' },
  { id: 'toilets', label: 'Toilets', glyph: 'WC' },
  { id: 'services', label: 'Services', glyph: 'i' },
  { id: 'transport', label: 'Transport', glyph: '▣' },
  { id: 'arrival', label: 'Arrival', glyph: '⚑' },
];

export const DEFAULT_MAP_LAYERS = new Set<MapLayer>(['essentials']);

/**
 * Marker silhouettes deliberately repeat only where the glyph still makes the
 * meaning unambiguous. Shape is the first cue at overview zoom; color and the
 * glyph are independent secondary cues for color-vision and small-screen use.
 */
export type PoiMarkerShape =
  | 'circle'
  | 'square'
  | 'diamond'
  | 'triangle'
  | 'hexagon'
  | 'pentagon'
  | 'octagon'
  | 'shield'
  | 'capsule';

export function poiShape(kind: PoiKind): PoiMarkerShape {
  switch (kind) {
    case 'medical': return 'octagon';
    case 'ranger': return 'shield';
    case 'temple': return 'diamond';
    case 'ice': return 'hexagon';
    case 'toilet': return 'capsule';
    case 'info':
    case 'playa-info': return 'square';
    case 'art-services': return 'pentagon';
    case 'recycle': return 'hexagon';
    case 'bike': return 'circle';
    case 'bus': return 'capsule';
    case 'airport': return 'triangle';
    case 'dmv':
    case 'media': return 'square';
    case 'greeters': return 'pentagon';
    case 'gate': return 'shield';
    case 'box-office':
    case 'will-call': return 'hexagon';
    case 'center-camp': return 'circle';
    case 'plaza': return 'diamond';
    default: return 'circle';
  }
}

export function poiGlyph(kind: PoiKind): string {
  switch (kind) {
    case 'medical': return '✚';
    case 'ranger': return 'R';
    case 'ice': return '❄';
    case 'temple': return 'T';
    case 'toilet': return 'WC';
    case 'info':
    case 'playa-info': return 'i';
    case 'art-services': return 'A';
    case 'recycle': return '♻';
    case 'bike': return 'B';
    case 'bus': return '▣';
    case 'airport': return '✈';
    case 'dmv': return 'D';
    case 'media': return 'M';
    case 'greeters': return 'G';
    case 'gate': return '⚑';
    case 'box-office': return '$';
    case 'will-call': return 'W';
    case 'center-camp': return 'C';
    case 'plaza': return 'P';
    default: return '•';
  }
}

/**
 * One unique color per semantic POI kind. The Record is intentionally
 * exhaustive: adding a new PoiKind cannot compile until it receives its own
 * palette slot, and the test suite rejects duplicate values. Shapes/glyphs
 * remain the primary accessibility cue; color makes dense overview scans
 * faster and keeps adjacent categories immediately recognizable.
 */
export const POI_COLORS: Readonly<Record<PoiKind, string>> = {
  'center-camp': '#c026d3', // magenta
  'playa-info': '#0369a1',  // dark blue
  plaza: '#0f766e',         // teal
  other: '#64748b',         // gray
  medical: '#dc2626',       // red
  ranger: '#4338ca',        // indigo
  ice: '#0284c7',           // sky blue
  temple: '#a16207',        // ochre/gold
  toilet: '#1d4ed8',        // royal blue
  info: '#155e75',          // deep cyan
  'art-services': '#be185d', // rose
  recycle: '#15803d',       // forest green
  bike: '#4d7c0f',          // olive
  bus: '#ea580c',           // orange
  airport: '#475569',       // slate
  dmv: '#854d0e',           // brown
  media: '#9f1239',         // burgundy
  greeters: '#047857',      // emerald
  gate: '#374151',          // charcoal
  'box-office': '#7e22ce',  // violet
  'will-call': '#0891b2',   // cyan
};

export function poiColor(kind: PoiKind): string {
  return POI_COLORS[kind];
}

export function isPoiVisible(poi: BrcPOI, enabled: ReadonlySet<MapLayer>): boolean {
  return poi.layer === 'base' || enabled.has(poi.layer);
}

export function validateGis(value: unknown, year: number): GisYearData {
  if (!value || typeof value !== 'object') return { ...EMPTY_GIS, year };
  const raw = value as Partial<GisYearData>;
  if (raw.year !== year || !Array.isArray(raw.points) || !Array.isArray(raw.toilets)) {
    return { ...EMPTY_GIS, year };
  }
  const validPoi = (p: unknown): p is BrcPOI => {
    if (!p || typeof p !== 'object') return false;
    const x = p as Partial<BrcPOI>;
    return typeof x.id === 'string' && typeof x.name === 'string'
      && typeof x.kind === 'string' && typeof x.layer === 'string'
      && typeof x.lat === 'number' && Number.isFinite(x.lat)
      && typeof x.lng === 'number' && Number.isFinite(x.lng);
  };
  const validPair = (pair: unknown): pair is number[] =>
    Array.isArray(pair) && pair.length >= 2
    && typeof pair[0] === 'number' && Number.isFinite(pair[0])
    && typeof pair[1] === 'number' && Number.isFinite(pair[1]);
  const validArea = (area: unknown): area is GisArea => {
    if (!area || typeof area !== 'object') return false;
    const x = area as Partial<GisArea>;
    return typeof x.id === 'string' && typeof x.name === 'string'
      && typeof x.kind === 'string' && typeof x.layer === 'string'
      && typeof x.poi_id === 'string' && Array.isArray(x.polygons)
      && x.polygons.length > 0
      && x.polygons.every((polygon) => Array.isArray(polygon)
        && polygon.length > 0
        && polygon.every((ring) => Array.isArray(ring)
          && ring.length >= 3 && ring.every(validPair)));
  };
  return {
    year,
    source: typeof raw.source === 'string' ? raw.source : '',
    points: raw.points.filter(validPoi),
    areas: Array.isArray(raw.areas) ? raw.areas.filter(validArea) : [],
    // The dedicated toilet layer was introduced after the first 2025/2026
    // normalized caches were generated. Canonicalize it here so an older
    // otherwise-valid cache cannot silently put all banks back into the
    // default-on Essentials layer.
    toilets: raw.toilets
      .filter((p) => validPoi(p) && p.kind === 'toilet'
        && Array.isArray((p as GisToilet).rings))
      .map((p) => ({ ...p, layer: 'toilets' as const } as GisToilet)),
  };
}

function base64ToBytes(text: string): Uint8Array {
  const trimmed = text.trim();
  const padded = trimmed + '='.repeat((4 - (trimmed.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function readEmbeddedGis(year: number): Promise<GisYearData> {
  if (typeof document === 'undefined') return { ...EMPTY_GIS, year };
  const el = document.getElementById(`gis-data-${year}`);
  if (!el) return { ...EMPTY_GIS, year };
  try {
    const bytes = base64ToBytes(el.textContent ?? '');
    const inflated = await decompressGzip(bytes);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(inflated));
    return validateGis(parsed, year);
  } catch {
    return { ...EMPTY_GIS, year };
  }
}
