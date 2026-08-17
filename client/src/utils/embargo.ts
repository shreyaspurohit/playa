// Current-year API location embargo (ADR D8 / BM API ToS §6.2).
//
// Burning Man publishes current-year camp and art location fields to app
// developers before those fields may be shown to normal users. The public
// cutoffs differ, so they are explicit annual timestamps rather than aliases
// for the schedule or spirit-mode access window.
//
// This remains a client-side UX boundary: encrypted source payloads retain
// raw locations. A wrapper emitted for the literal `god-mode` tier is marked
// trusted and bypasses both cutoffs for internal developer use. Spirit-mode
// and all other untrusted tiers follow the public schedule.
import type { Art, Camp, Source } from '../types';

export type LocationKind = 'camp' | 'art';

export interface LocationReleasePolicy {
  /** Current live API/map year (normally BRC_MAP_YEAR). */
  year: number;
  /** Timezone-aware ISO-8601 public release timestamps. */
  campReleaseAt: string;
  artReleaseAt: string;
}

function apiYear(source: Source): number | null {
  const match = /^api-(\d{4})$/.exec(source);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function releaseAtFor(
  policy: LocationReleasePolicy,
  kind: LocationKind,
): string {
  return kind === 'camp' ? policy.campReleaseAt : policy.artReleaseAt;
}

/** Decide whether one location-field class must be hidden.
 *
 * - Historical API years pass through.
 * - The configured current API year compares against its kind-specific time.
 * - Future API years fail closed until the annual policy is advanced.
 * - Missing/malformed current-year metadata fails closed in the client; the
 *   builder also rejects such a production build before it can be deployed.
 * - Trusted god-mode bypasses the UX gate intentionally.
 */
export function isLocationEmbargoed(
  source: Source,
  policy: LocationReleasePolicy,
  kind: LocationKind,
  now: Date = new Date(),
  trusted: boolean = false,
): boolean {
  if (trusted) return false;
  const sourceYear = apiYear(source);
  if (sourceYear === null) return true;

  if (!Number.isInteger(policy.year) || policy.year < 2000) return true;
  if (sourceYear < policy.year) return false;
  if (sourceYear > policy.year) return true;

  const releaseTime = Date.parse(releaseAtFor(policy, kind));
  if (Number.isNaN(releaseTime)) return true;
  return now.getTime() < releaseTime;
}

/** Camp-location helper retained for direct render paths and tests. */
export function maskLocation(
  raw: string,
  source: Source,
  policy: LocationReleasePolicy,
  now: Date = new Date(),
  trusted: boolean = false,
): string {
  return isLocationEmbargoed(source, policy, 'camp', now, trusted) ? '' : raw;
}

/** Clear `camp.location` before downstream components receive the records. */
export function applyLocationEmbargo(
  camps: Camp[],
  source: Source,
  policy: LocationReleasePolicy,
  now: Date = new Date(),
  trusted: boolean = false,
): Camp[] {
  if (!isLocationEmbargoed(source, policy, 'camp', now, trusted)) return camps;
  return camps.map((camp) => ({ ...camp, location: '' }));
}

/** Clear `art.location` using art's later, gate-open release timestamp. */
export function applyArtLocationEmbargo(
  art: Art[],
  source: Source,
  policy: LocationReleasePolicy,
  now: Date = new Date(),
  trusted: boolean = false,
): Art[] {
  if (!isLocationEmbargoed(source, policy, 'art', now, trusted)) return art;
  return art.map((piece) => ({ ...piece, location: '' }));
}
