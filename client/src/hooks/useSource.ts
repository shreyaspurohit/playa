// Active data-source state. Reads `<meta name="bm-sources">` for the
// list embedded in this build, picks the user's previous selection
// from `localStorage[bm-source]` (validated against the embedded
// list), defaults to the first embedded source.
//
// Cross-tab: storage events keep tabs in sync — flipping the source
// in one tab updates the other.
//
// Migration: on first run after the multi-source upgrade, we copy
// each legacy unsuffixed key (bm-favs, bm-fav-events, bm-shared,
// bm-my-camp, bm-meet-spots, bm-hidden-days) into its `/directory`
// slot. Bare keys are left in place so an older bundle (cached SW,
// other tab) still finds its data — see ADR D4.
import { useCallback, useEffect, useState } from 'preact/hooks';
import { LS, type Source } from '../types';
import { readString, writeString } from '../utils/storage';
import { DIRECTORY_YEAR, type BrcMapData, getBrcForYear } from '../map/data';

const SCOPED_BASE_KEYS = [
  LS.favs, LS.favEvents, LS.sharedFavs,
  LS.myCampId, LS.meetSpots, LS.hiddenDays,
];

/** Resolve a source identifier to the burn year its data represents.
 *
 *   `directory` → `DIRECTORY_YEAR` (the year being currently fetched —
 *                   bumped by the /update-map skill at year rollover)
 *   `api-YYYY`  → `YYYY`
 *   anything else → DIRECTORY_YEAR (best-guess fallback)
 *
 * Drives the per-year map geometry lookup in MapView (ADR D11). */
export function yearForSource(source: Source): number {
  if (source === 'directory') return DIRECTORY_YEAR;
  const m = /^api-(\d{4})$/.exec(source);
  if (m) return parseInt(m[1], 10);
  return DIRECTORY_YEAR;
}

/** Resolve a source identifier directly to its BRC geometry constants. */
export function brcForSource(source: Source): BrcMapData {
  return getBrcForYear(yearForSource(source));
}

/** Sources embedded in this build, in declaration order (first = default). */
export function availableSources(): Source[] {
  if (typeof document === 'undefined') return ['directory'];
  const m = document.querySelector('meta[name="bm-sources"]');
  const raw = (m?.getAttribute('content') ?? '').trim();
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : ['directory'];
}

/** One-shot copy of legacy unsuffixed keys → `<key>/directory`.
 *  Idempotent: safe to call on every mount; the flag short-circuits
 *  after the first run. Bare keys are NOT removed (compat for any
 *  cached older bundle still running in another tab). */
export function migrateLegacyKeysOnce(): void {
  if (typeof localStorage === 'undefined') return;
  const flag = readString(LS.legacyKeysMigrated, '');
  if (flag === '1') return;
  for (const base of SCOPED_BASE_KEYS) {
    const legacy = readString(base, '');
    if (!legacy) continue;
    const target = `${base}/directory`;
    // Don't overwrite a per-source value that already exists — the
    // user might have run a newer bundle in some other tab first.
    const existing = readString(target, '');
    if (existing) continue;
    writeString(target, legacy);
  }
  writeString(LS.legacyKeysMigrated, '1');
}

export interface SourceApi {
  source: Source;
  setSource: (s: Source) => void;
  available: Source[];
}

export function useSource(): SourceApi {
  const available = availableSources();
  const [source, setSourceState] = useState<Source>(() => {
    const stored = readString(LS.source, '');
    if (stored && available.includes(stored)) return stored;
    return available[0];
  });

  // Persist + propagate. setSource updates LS, which fires a storage
  // event in OTHER tabs — those tabs hit the listener below and
  // re-sync. Same-tab updates go through the React state path.
  const setSource = useCallback((next: Source) => {
    if (!available.includes(next)) return;
    writeString(LS.source, next);
    setSourceState(next);
  }, [available]);

  useEffect(() => {
    const win = typeof window !== 'undefined' ? window : null;
    if (!win) return;
    function onStorage(e: StorageEvent) {
      if (e.key !== null && e.key !== LS.source) return;
      const stored = readString(LS.source, '');
      if (stored && available.includes(stored)) setSourceState(stored);
    }
    win.addEventListener('storage', onStorage);
    return () => win.removeEventListener('storage', onStorage);
  }, [available]);

  return { source, setSource, available };
}
