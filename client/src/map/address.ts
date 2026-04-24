// Convert BRC addresses ("7:30 & F", "Esplanade & 9:00") to polar
// coordinates (bearing from Man + distance in feet) and from there to
// lat/lng or SVG (x, y).
//
// Address grammar in the fetched directory is remarkably permissive:
//
//   "7:30 & F"       most common
//   "F & 7:30"       also seen (order reversed)
//   "5:00 & B"
//   "Esplanade & 9:00"
//   "None Listed"    camps that haven't picked a spot — returns null
//   "" / "-"         same
//
// We parse case-insensitively and accept letter (A-K) or the full street
// name. Anything we can't match returns null; callers handle gracefully.
import { BRC } from './data';

export interface PolarAddress {
  /** Clock hour as a decimal — 4:30 → 4.5, 7:45 → 7.75 */
  clockHour: number;
  /** Radius in feet from the Man (uses BRC.streetRadiiFeet). */
  radiusFeet: number;
  /** Street letter — "Esplanade" or "A"–"K" */
  street: string;
  /** Clock string, normalized — "4:30" not "4:30:00" */
  clock: string;
}

const CLOCK_RE = /(\d{1,2}):(\d{2})/;

function parseClock(s: string): { hour: number; clock: string } | null {
  const m = s.match(CLOCK_RE);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 1 || h > 12 || min >= 60) return null;
  return { hour: h + min / 60, clock: `${h}:${m[2]}` };
}

function parseStreet(s: string): { street: string; radiusFeet: number } | null {
  const up = s.trim().toUpperCase();
  // Single letter match
  if (/^[A-K]$/.test(up)) {
    const idx = BRC.streetLetters.indexOf(up);
    if (idx >= 0) return { street: up, radiusFeet: BRC.streetRadiiFeet[idx] };
  }
  // "Esplanade" or a full themed name
  const normalized = s.trim().toLowerCase();
  const nameIdx = BRC.streetNames.findIndex((n) => n.toLowerCase() === normalized);
  if (nameIdx >= 0) {
    return {
      street: BRC.streetLetters[nameIdx],
      radiusFeet: BRC.streetRadiiFeet[nameIdx],
    };
  }
  // "Esplanade" also matches even when not themed
  if (normalized === 'esplanade') {
    return { street: 'Esplanade', radiusFeet: BRC.streetRadiiFeet[0] };
  }
  return null;
}

export function parseAddress(raw: string): PolarAddress | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '-' || /none listed/i.test(trimmed)) return null;

  // Split on "&" or "and"; try each side as clock, the other as street.
  const parts = trimmed.split(/\s*(?:&|\band\b)\s*/i).map((p) => p.trim());
  if (parts.length < 2) return null;

  for (const [a, b] of [parts, [parts[1], parts[0]]]) {
    const clock = parseClock(a);
    const street = parseStreet(b);
    if (clock && street) {
      return {
        clockHour: clock.hour,
        clock: clock.clock,
        street: street.street,
        radiusFeet: street.radiusFeet,
      };
    }
  }
  return null;
}

/**
 * Compass bearing (degrees clockwise from True North) for a given BRC
 * clock position, looking outward from the Man. 12:00 bearing is the
 * year-specific constant `BRC.twelveBearingDeg` (225° in 2026).
 */
export function clockToCompass(clockHour: number): number {
  // Each hour on the BRC face = 30° clockwise. 12:00 = hour 12 = 0h offset.
  const hoursFrom12 = clockHour === 12 ? 0 : clockHour;
  return (BRC.twelveBearingDeg + hoursFrom12 * 30) % 360;
}

const FEET_PER_METER = 3.28084;
const EARTH_RADIUS_M = 6371008.8;

/** Translate (origin lat/lng, bearing_deg, distance_ft) → new lat/lng. */
export function destinationPoint(
  lat: number, lng: number, bearingDeg: number, distanceFt: number,
): { lat: number; lng: number } {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const distMeters = distanceFt / FEET_PER_METER;
  const angDist = distMeters / EARTH_RADIUS_M;
  const brng = toRad(bearingDeg);
  const φ1 = toRad(lat);
  const λ1 = toRad(lng);
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(angDist) + Math.cos(φ1) * Math.sin(angDist) * Math.cos(brng),
  );
  const λ2 = λ1 + Math.atan2(
    Math.sin(brng) * Math.sin(angDist) * Math.cos(φ1),
    Math.cos(angDist) - Math.sin(φ1) * Math.sin(φ2),
  );
  return { lat: toDeg(φ2), lng: ((toDeg(λ2) + 540) % 360) - 180 };
}

/** Great-circle distance in meters. */
export function haversineMeters(
  a: { lat: number; lng: number }, b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δφ = toRad(b.lat - a.lat);
  const Δλ = toRad(b.lng - a.lng);
  const h = Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Compass bearing from a→b. */
export function bearingDeg(
  a: { lat: number; lng: number }, b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Resolve an address string to real-world lat/lng via the Man + polar math. */
export function addressToLatLng(raw: string): { lat: number; lng: number } | null {
  const p = parseAddress(raw);
  if (!p) return null;
  const compass = clockToCompass(p.clockHour);
  return destinationPoint(
    BRC.center.lat, BRC.center.lng, compass, p.radiusFeet,
  );
}

/**
 * Place an address on a unit SVG grid where (0,0) is the Man and
 * +y points "up the page" (toward BRC 12:00). The caller scales into
 * its own viewBox. Output in feet — consumer divides by `radiusFeet /
 * viewBoxRadius` to fit.
 */
export function addressToSvgFeet(raw: string): { x: number; y: number } | null {
  const p = parseAddress(raw);
  if (!p) return null;
  // On our unit grid, "12:00 up" → clock-hour 0 → (0, +r). Clock position
  // rotates clockwise. sin/cos of hour-angle in radians, hour-angle grows
  // clockwise from up-axis.
  const theta = (p.clockHour / 12) * 2 * Math.PI;
  return {
    x: p.radiusFeet * Math.sin(theta),
    y: -p.radiusFeet * Math.cos(theta), // SVG y grows down; negate so 12:00 is up
  };
}

/** Convert a GPS fix to SVG-feet coordinates, relative to the Man and with
    BRC 12:00 pointing up. Used to show the "you are here" dot. */
export function latLngToSvgFeet(
  fix: { lat: number; lng: number },
): { x: number; y: number } {
  const compass = bearingDeg(BRC.center, fix);
  const distMeters = haversineMeters(BRC.center, fix);
  const distFt = distMeters * FEET_PER_METER;
  // Compass bearing → clock-hour in BRC frame
  let hourAngleDeg = compass - BRC.twelveBearingDeg; // degrees clockwise from 12:00
  hourAngleDeg = ((hourAngleDeg % 360) + 360) % 360;
  const theta = (hourAngleDeg * Math.PI) / 180;
  return {
    x: distFt * Math.sin(theta),
    y: -distFt * Math.cos(theta),
  };
}

/** Reverse of `addressToLatLng` — given a GPS fix, return the BRC
 *  address that's closest to it. Clock hour is rounded to the nearest
 *  15 minutes. Letter street is the ring closest by radius (may be
 *  "Esplanade" for the innermost). Returns null when the fix is past
 *  the outermost ring + a generous buffer (deep playa / off playa) —
 *  showing "12:00 & K" for a user at the Temple would be misleading. */
export function latLngToAddress(
  fix: { lat: number; lng: number },
): { clock: string; street: string; clockHour: number; radiusFeet: number } | null {
  const compass = bearingDeg(BRC.center, fix);
  const distMeters = haversineMeters(BRC.center, fix);
  const distFt = distMeters * FEET_PER_METER;

  // A sanity buffer past K-street. Beyond this the user is clearly in
  // open playa (Temple, art, deep-playa rangers) — no BRC address.
  const outerR = BRC.streetRadiiFeet[BRC.streetRadiiFeet.length - 1];
  if (distFt > outerR + 1500) return null;
  // Too close to the Man to name a ring either — they're inside the
  // inner-Esplanade walk, which isn't a street.
  if (distFt < BRC.streetRadiiFeet[0] - 600) return null;

  // Hour-angle = compass bearing minus the BRC 12:00 anchor, mapped
  // back into [0, 360). Convert to decimal clock hour in [0, 12).
  let hourAngleDeg = compass - BRC.twelveBearingDeg;
  hourAngleDeg = ((hourAngleDeg % 360) + 360) % 360;
  const rawHour = (hourAngleDeg / 360) * 12;
  // Round to nearest 15-minute increment — matches the granularity
  // camps address themselves with (7:00, 7:15, 7:30, 7:45).
  const quarterSteps = Math.round(rawHour * 4);
  const normalized = ((quarterSteps % 48) + 48) % 48;   // 48 quarters in 12h
  const hours = Math.floor(normalized / 4);
  const minutes = (normalized % 4) * 15;
  const hourLabel = hours === 0 ? 12 : hours;
  const clock = `${hourLabel}:${minutes.toString().padStart(2, '0')}`;
  const clockHour = hourLabel + minutes / 60;

  // Pick the nearest ring by radial distance.
  let bestIdx = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < BRC.streetRadiiFeet.length; i++) {
    const delta = Math.abs(BRC.streetRadiiFeet[i] - distFt);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIdx = i;
    }
  }

  return {
    clock,
    street: BRC.streetLetters[bestIdx],
    clockHour,
    radiusFeet: BRC.streetRadiiFeet[bestIdx],
  };
}
