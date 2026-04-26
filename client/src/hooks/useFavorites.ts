// Generic favorites Set backed by localStorage. Used twice: once for
// camp ids (bm-favs) and once for event ids (bm-fav-events). Listens
// to storage events so a star toggle in tab A reflects live in tab B
// (storage events fire on every OTHER tab of the same origin, never
// on the writer — that case is covered by the local setFavs call).
import { useCallback, useEffect, useState } from 'preact/hooks';
import { readStringSet, writeStringSet } from '../utils/storage';

export interface FavoritesApi {
  favs: Set<string>;
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  clear: () => void;
  size: number;
}

export function useFavorites(storageKey: string): FavoritesApi {
  const [favs, setFavs] = useState<Set<string>>(() => readStringSet(storageKey));

  const toggle = useCallback(
    (id: string) => {
      setFavs((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        writeStringSet(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  const clear = useCallback(() => {
    writeStringSet(storageKey, new Set());
    setFavs(new Set());
  }, [storageKey]);

  useEffect(() => {
    // Capture window in closure so cleanup uses the same reference
    // even if globalThis.window was swapped (test-infra teardown).
    const win = typeof window !== 'undefined' ? window : null;
    if (!win) return;
    function onStorage(e: StorageEvent) {
      // e.key === null means storage.clear() — re-read either way.
      if (e.key !== null && e.key !== storageKey) return;
      setFavs(readStringSet(storageKey));
    }
    win.addEventListener('storage', onStorage);
    return () => win.removeEventListener('storage', onStorage);
  }, [storageKey]);

  return {
    favs,
    has: (id: string) => favs.has(id),
    toggle,
    clear,
    size: favs.size,
  };
}
