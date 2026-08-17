// Single source of "now" for the whole app. All time-based logic (Food
// availability, Schedule now/near-me, the location embargo) reads `now()`
// instead of `new Date()` so we can simulate a date/time for manual testing.
//
// Set a simulated instant by adding `?now=<ISO>` to the URL, e.g.
//   https://playa.purohit.dev/?now=2026-08-31T13:00:00-07:00#food
// It's persisted to localStorage so it survives navigation/reload during a
// test session, and a banner makes it obvious the clock is faked. Clear it
// with clearMockNow() (the banner's button) or by removing the LS key.
//
// The simulated clock is FROZEN (returns the same instant on every call) —
// deterministic for testing "is this serving now / starting soon".
import { LS } from '../types';
import { readString, writeString, removeKey } from './storage';

/** Event display times are interpreted as Black Rock City local times. */
export const PLAYA_TIME_ZONE = 'America/Los_Angeles';

export interface PlayaTimeParts {
  year: number;
  weekday: string;
  month: number;
  day: number;
  hours: number;
  minutes: number;
}

const PLAYA_PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: PLAYA_TIME_ZONE,
  year: 'numeric',
  weekday: 'short',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

/** Resolve an instant into the wall-clock fields used by playa event times. */
export function playaTimeParts(when: Date): PlayaTimeParts {
  const parts = Object.fromEntries(
    PLAYA_PARTS_FORMATTER.formatToParts(when)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    weekday: parts.weekday,
    month: Number(parts.month),
    day: Number(parts.day),
    hours: Number(parts.hour),
    minutes: Number(parts.minute),
  };
}

/** Concise user-facing label for an instant in playa local time. */
export function formatPlayaTime(when: Date): string {
  return when.toLocaleTimeString([], {
    timeZone: PLAYA_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Human-readable playa timestamp for freshness/status labels. */
export function formatPlayaDateTime(when: Date): string {
  const time = when.toLocaleTimeString('en-US', {
    timeZone: PLAYA_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  const date = when.toLocaleDateString('en-US', {
    timeZone: PLAYA_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${time} on ${date}`;
}

// Resolved cheaply on every call (a regex + one localStorage read) so clearing
// the override takes effect immediately and it's trivially testable. A `now=`
// param anywhere in the URL is persisted to localStorage the first time it's
// seen, so it survives even the hash router rewriting the fragment.
function readNowParam(): string | null {
  if (typeof location === 'undefined') return null;
  // Accept `now=` in the query (?now=) OR anywhere in the hash (#…now=…).
  // Hash-based routing can shuffle a fragment-placed param, so don't require
  // it to sit in location.search — scan the whole href.
  const m = /[?#&]now=([^&#]+)/.exec(location.href);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

function resolve(): number | null {
  const fromUrl = readNowParam();
  if (fromUrl) {
    const t = Date.parse(fromUrl);
    if (!Number.isNaN(t)) { writeString(LS.mockNow, fromUrl); return t; }
  }
  const stored = readString(LS.mockNow, '');
  if (stored) {
    const t = Date.parse(stored);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

/** Current time — the simulated instant when one is set, else the real clock. */
export function now(): Date {
  const t = resolve();
  return t === null ? new Date() : new Date(t);
}

/** True when a simulated clock is active. */
export function isMockNow(): boolean {
  return resolve() !== null;
}

/** Human label for the banner, or '' when the clock is live. */
export function mockNowLabel(): string {
  return isMockNow() ? now().toLocaleString() : '';
}

/** Stop simulating — drop the override so the real clock resumes. */
export function clearMockNow(): void {
  removeKey(LS.mockNow);
  if (typeof location === 'undefined' || typeof history === 'undefined') return;

  // A URL override takes precedence over localStorage, so remove it before the
  // banner reloads. Handle both the normal query form and the legacy/hash forms
  // accepted by readNowParam().
  const url = new URL(location.href);
  url.searchParams.delete('now');
  let hash = url.hash.slice(1);
  hash = hash
    .replace(/(^|[?&])now=[^&]*/g, '')
    .replace(/^[?&]+|[?&]+$/g, '')
    .replace(/\?&/g, '?');
  url.hash = hash;
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
