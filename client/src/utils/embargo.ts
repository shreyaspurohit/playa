// Pre-burn location embargo (ADR D8 / BM API ToS §6.2).
//
// User-visible camp locations must remain hidden for the current
// burn year's API source until gate-open. We choose to enforce this
// CLIENT-SIDE (the encrypted bundle still carries full location data
// post-decrypt) so:
//   * builds don't need re-running when the embargo lifts — the
//     existing site automatically starts showing locations once the
//     user's clock crosses `burn-start`,
//   * past-year API sources (api-2024, api-2025, …) are unaffected,
//   * directory and other sources are unaffected (directory is
//     god-mode-only by intent).
//
// We embargo by SOURCE — when the active source is `api-<burn_year>`
// AND today < burn_start, the UI strips locations. Other sources
// (directory, past-year API) are never embargoed.
//
// Note: this is a UX gate, not a security boundary. Users with
// DevTools could still pull location strings out of the decrypted
// payload in memory. Build-time stripping would be more airtight
// but breaks the "rebuild-not-required" property the operator
// wanted. ToS §6.2 talks about what's *shown* to users, which the
// UI hide satisfies in spirit.
import type { Source } from '../types';
import { yearForSource } from '../hooks/useSource';

/** True iff the active source is the current burn year's API source
 *  AND today (UTC, day granularity) is strictly before `burnStart`.
 *
 *  `burnStart` comes from the `<meta name="bm-burn-start">` tag the
 *  Python builder emits — same string the schedule view uses. ISO
 *  date format `YYYY-MM-DD`.
 *
 *  `trusted` is a per-tier flag set by the build's
 *  `bm-trusted-wrappers` manifest — when the user's password unwrapped
 *  a god-mode wrapper, this is true and the embargo is bypassed for
 *  every source. The build only flags god-mode (not demigod or
 *  spirit), so non-god tiers continue to honor §6.2. The flag never
 *  reveals the tier's name to the DOM. */
export function isLocationEmbargoed(
  source: Source,
  burnStart: string,
  now: Date = new Date(),
  trusted: boolean = false,
): boolean {
  if (trusted) return false;
  if (!burnStart) return false;
  // Only `api-<YYYY>` sources are embargoable — the directory and
  // any other source family is left alone (directory is god-mode-
  // only by intent; no embargo case for past-year API).
  if (!source.startsWith('api-')) return false;
  const sourceYear = yearForSource(source);
  // Parse `YYYY-MM-DD` as UTC midnight. Day-granularity comparison
  // matches the build-side cron's UTC `today` semantics — worst-case
  // ~7h skew vs Black-Rock midnight, which is operationally fine.
  const burnDate = new Date(burnStart + 'T00:00:00Z');
  if (Number.isNaN(burnDate.getTime())) return false;
  if (sourceYear !== burnDate.getUTCFullYear()) return false;
  return now.getTime() < burnDate.getTime();
}

/** Convenience for callers that want to turn `camp.location` into
 *  empty when the embargo is active without sprinkling conditionals
 *  through every render path. Pass through when the embargo isn't
 *  active. */
export function maskLocation(
  raw: string,
  source: Source,
  burnStart: string,
  now: Date = new Date(),
  trusted: boolean = false,
): string {
  return isLocationEmbargoed(source, burnStart, now, trusted) ? '' : raw;
}

import type { Camp } from '../types';

/** Apply the embargo to a camp list at ingest time. When the active
 *  source's `api-<burn_year>` is pre-burn AND the user is not trusted,
 *  returns a shallow-cloned array with each camp's `location` cleared.
 *  Otherwise returns the array unchanged (no copy).
 *
 *  Called by App.tsx wherever a fresh Camp[] arrives — after plaintext
 *  parse, after Gate decrypt, after envelope cipher decrypt. Downstream
 *  consumers (CampCard, ScheduleView, MapView) see the masked array
 *  and naturally hide locations: empty string renders as `—`,
 *  empty addresses can't be resolved to map pins, etc.
 *
 *  Limitation: ingestion is a one-shot decision. If the user's tab
 *  stays open across burn-start midnight, the masked state doesn't
 *  auto-update — they need to refresh. Acceptable trade-off vs. a
 *  ticking-clock state subscription. */
export function applyLocationEmbargo(
  camps: Camp[],
  source: Source,
  burnStart: string,
  now: Date = new Date(),
  trusted: boolean = false,
): Camp[] {
  if (!isLocationEmbargoed(source, burnStart, now, trusted)) return camps;
  return camps.map((c) => ({ ...c, location: '' }));
}
