// Self-authored rendezvous plans — small list of "where you plan to
// be, and when." Backed by LS.meetSpots as a JSON array so the share
// flow can embed the whole list verbatim in its URL payload. Mirrors
// the useFavorites API shape (array + add/remove/clear) even though
// the underlying values are objects, not opaque ids.
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { MeetSpot } from '../types';
import { LS } from '../types';
import { readString, writeString } from '../utils/storage';

function load(): MeetSpot[] {
  try {
    const raw = readString(LS.meetSpots, '');
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

function save(list: MeetSpot[]): void {
  writeString(LS.meetSpots, JSON.stringify(list));
}

export interface MeetSpotsApi {
  spots: MeetSpot[];
  add: (spot: MeetSpot) => void;
  removeAt: (idx: number) => void;
  clear: () => void;
}

export function useMeetSpots(): MeetSpotsApi {
  const [spots, setSpots] = useState<MeetSpot[]>(load);

  const add = useCallback((spot: MeetSpot) => {
    setSpots((prev) => {
      const next = [...prev, spot];
      save(next);
      return next;
    });
  }, []);

  const removeAt = useCallback((idx: number) => {
    setSpots((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      save(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    save([]);
    setSpots([]);
  }, []);

  // Multi-tab sync: another tab's add/remove fires `storage` here.
  useEffect(() => {
    const win = typeof window !== 'undefined' ? window : null;
    if (!win) return;
    function onStorage(e: StorageEvent) {
      if (e.key !== null && e.key !== LS.meetSpots) return;
      setSpots(load());
    }
    win.addEventListener('storage', onStorage);
    return () => win.removeEventListener('storage', onStorage);
  }, []);

  return { spots, add, removeAt, clear };
}
