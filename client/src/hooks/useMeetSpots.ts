// Self-authored rendezvous plans — small list of "where you plan to
// be, and when." Backed by `storageKey` (a per-source scoped slot
// like `bm-meet-spots/api-2024`) as a JSON array so the share flow
// can embed the whole list verbatim in its URL payload. Mirrors
// the useFavorites API shape (array + add/remove/clear) even though
// the underlying values are objects, not opaque ids.
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { MeetSpot } from '../types';
import { readString, writeString } from '../utils/storage';

function load(storageKey: string): MeetSpot[] {
  try {
    const raw = readString(storageKey, '');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive filter in case a previous app version wrote something else.
    return parsed.filter((x): x is MeetSpot =>
      !!x && typeof x === 'object'
      && typeof x.label === 'string' && typeof x.address === 'string'
    );
  } catch {
    return [];
  }
}

function save(storageKey: string, list: MeetSpot[]): void {
  writeString(storageKey, JSON.stringify(list));
}

export interface MeetSpotsApi {
  spots: MeetSpot[];
  add: (spot: MeetSpot) => void;
  removeAt: (idx: number) => void;
  clear: () => void;
}

export function useMeetSpots(storageKey: string): MeetSpotsApi {
  const [spots, setSpots] = useState<MeetSpot[]>(() => load(storageKey));

  // Re-read on data-source switch. Ref-guarded so the no-op pass on
  // first mount doesn't stomp on a setSpots that landed in the same
  // render (caused subtle test-isolation failures earlier).
  const lastKeyRef = useRef<string>(storageKey);
  useEffect(() => {
    if (lastKeyRef.current === storageKey) return;
    lastKeyRef.current = storageKey;
    setSpots(load(storageKey));
  }, [storageKey]);

  const add = useCallback((spot: MeetSpot) => {
    setSpots((prev) => {
      const next = [...prev, spot];
      save(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const removeAt = useCallback((idx: number) => {
    setSpots((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      save(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const clear = useCallback(() => {
    save(storageKey, []);
    setSpots([]);
  }, [storageKey]);

  // Multi-tab sync: another tab's add/remove fires `storage` here.
  useEffect(() => {
    const win = typeof window !== 'undefined' ? window : null;
    if (!win) return;
    function onStorage(e: StorageEvent) {
      if (e.key !== null && e.key !== storageKey) return;
      setSpots(load(storageKey));
    }
    win.addEventListener('storage', onStorage);
    return () => win.removeEventListener('storage', onStorage);
  }, [storageKey]);

  return { spots, add, removeAt, clear };
}
