// Generic favorites Set backed by localStorage. Used twice: once for
// camp ids (bm-favs) and once for event ids (bm-fav-events).
import { useCallback, useState } from 'preact/hooks';
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

  return {
    favs,
    has: (id: string) => favs.has(id),
    toggle,
    clear,
    size: favs.size,
  };
}
