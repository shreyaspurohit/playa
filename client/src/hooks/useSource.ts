// Active data-source state. Reads `<meta name="bm-sources">` for the
// list embedded in this build, picks the user's previous selection
// from `localStorage[bm-source]` (validated against the embedded
// list), defaults to the first embedded source.
//
// Cross-tab: storage events keep tabs in sync — flipping the source
// in one tab updates the other.
//
import { useCallback, useEffect, useState } from 'preact/hooks';
import { LS, type Source } from '../types';
import { readString, writeString } from '../utils/storage';
import { CURRENT_BRC_YEAR, type BrcMapData, getBrcForYear } from '../map/data';

function configuredBrcYear(): number {
  if (typeof document !== 'undefined') {
    const raw = document.querySelector('meta[name="bm-brc-map-year"]')
      ?.getAttribute('content');
    const year = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (Number.isInteger(year) && year >= 2000 && year <= 2200) return year;
  }
  return CURRENT_BRC_YEAR;
}

/** Resolve a source identifier to the burn year its data represents.
 *
 *   `api-YYYY`  → `YYYY`
 *   anything else → the configured current BRC year
 *
 * Drives the per-year map geometry lookup in MapView (ADR D11). */
export function yearForSource(source: Source): number {
  const m = /^api-(\d{4})$/.exec(source);
  if (m) return parseInt(m[1], 10);
  return configuredBrcYear();
}

/** Resolve a source only to exact-year BRC geometry.
 * Null is an expected staged-release state, never an invitation to borrow a
 * different year's coordinates. */
export function brcForSource(source: Source): BrcMapData | null {
  return getBrcForYear(yearForSource(source));
}

/** Sources embedded in this build, in declaration order (first = default). */
export function availableSources(): Source[] {
  const fallback = [`api-${configuredBrcYear()}`];
  if (typeof document === 'undefined') return fallback;
  const m = document.querySelector('meta[name="bm-sources"]');
  const raw = (m?.getAttribute('content') ?? '').trim();
  const parts = raw.split(',').map((s) => s.trim()).filter((s) => /^api-\d{4}$/.test(s));
  return parts.length > 0 ? parts : fallback;
}

/** Pick the source that visible labels and source-specific notices should use.
 *  A persisted selection can be outside an envelope password's unlocked set;
 *  state is corrected in an effect, but this synchronous fallback prevents a
 *  one-frame display of copy for an unavailable source. */
export function sourceForDisplay(
  selected: Source,
  available: Source[],
): Source {
  return available.includes(selected)
    ? selected
    : (available[0] ?? `api-${configuredBrcYear()}`);
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
