// Friends = other people's imported favorites. We keep them separate
// from `bm-favs` / `bm-fav-events` (which are always YOU) so the fav
// filter can surface "who starred this" per camp.
//
// Per-source: `storageKey` is the scoped slot like
// `bm-shared/api-2024`. Each source has its own friends map because
// camp ids don't cross sources (numeric directory ids vs. SFDC uids).
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { FriendFavs, MeetSpot } from '../types';
import { readString, writeString } from '../utils/storage';

/** Options bag for importFriend. Keeps the call site readable as the
 *  payload grows — today it's campIds/eventIds/myCampId/meetSpots. */
export interface ImportFriendInput {
  campIds: string[];
  eventIds: string[];
  artIds?: string[];
  myCampId?: string;
  meetSpots?: MeetSpot[];
}

type FriendsMap = Record<string, FriendFavs>;

function loadFriends(storageKey: string): FriendsMap {
  try {
    const raw = readString(storageKey, '');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as FriendsMap;
  } catch { /* bad JSON */ }
  return {};
}

function persistFriends(storageKey: string, friends: FriendsMap): void {
  writeString(storageKey, JSON.stringify(friends));
}

export interface FriendsApi {
  friends: FriendsMap;
  names: string[];
  /**
   * Persist a friend's share. The `input` bundle covers the full
   * payload: starred camps + events, optionally their own home camp,
   * optionally their meet spots.
   *
   *   mode='merge'     → union with existing (default historical behavior)
   *   mode='overwrite' → replace the entry under `name` outright
   *
   * For myCampId + meetSpots, merge semantics are "latest share wins" —
   * sender's current location/plans always replace any stale stored
   * ones (unlike favorites which union, since un-starring via re-share
   * would be surprising).
   */
  importFriend: (
    name: string, input: ImportFriendInput,
    mode?: 'merge' | 'overwrite',
  ) => void;
  /** Drop one friend entirely. */
  removeFriend: (name: string) => void;
  /** Drop every friend. */
  clear: () => void;
  /** Remove this friend's star on a single item ("hide their star
   *  on this camp / event / art"). Friend record stays put for
   *  their other stars. If the removal empties their bag entirely
   *  (no camp / event / art / myCampId / meetSpots left), the
   *  friend is dropped automatically. */
  removeFriendStar: (
    name: string,
    kind: 'camp' | 'event' | 'art',
    id: string,
  ) => void;
  /** Remove a single meet spot from a friend's plans by its index
   *  in their meetSpots array (which is how MapView identifies them).
   *  Same auto-drop behavior as `removeFriendStar` when the friend's
   *  bag empties. */
  removeFriendMeetSpot: (name: string, idx: number) => void;
  /** Any friend fav'd this camp? (used by the filter). */
  anyFriendFavCamp: (campId: string) => boolean;
  /** Any friend fav'd this event? */
  anyFriendFavEvent: (eventId: string) => boolean;
  /** Any friend fav'd this art piece? */
  anyFriendFavArt: (artId: string) => boolean;
  /** Names of friends who fav'd this camp. */
  friendsFavingCamp: (campId: string) => string[];
  /** Names of friends who fav'd this event. */
  friendsFavingEvent: (eventId: string) => string[];
  /** Names of friends who fav'd this art piece. */
  friendsFavingArt: (artId: string) => string[];
}

export function useFriends(storageKey: string): FriendsApi {
  const [friends, setFriends] = useState<FriendsMap>(() => loadFriends(storageKey));

  // Re-read on data-source switch (ref-guarded — see useMeetSpots).
  const lastKeyRef = useRef<string>(storageKey);
  useEffect(() => {
    if (lastKeyRef.current === storageKey) return;
    lastKeyRef.current = storageKey;
    setFriends(loadFriends(storageKey));
  }, [storageKey]);

  const importFriend = useCallback(
    (
      name: string, input: ImportFriendInput,
      mode: 'merge' | 'overwrite' = 'merge',
    ) => {
      setFriends((prev) => {
        const existing = prev[name];
        const baseCamps  = mode === 'overwrite' || !existing ? [] : existing.campIds;
        const baseEvents = mode === 'overwrite' || !existing ? [] : existing.eventIds;
        const baseArt    = mode === 'overwrite' || !existing ? [] : (existing.artIds ?? []);
        const mergedCamps = new Set<string>(baseCamps);
        input.campIds.forEach((id) => mergedCamps.add(String(id)));
        const mergedEvents = new Set<string>(baseEvents);
        input.eventIds.forEach((id) => mergedEvents.add(String(id)));
        const mergedArt = new Set<string>(baseArt);
        (input.artIds ?? []).forEach((id) => mergedArt.add(String(id)));
        // myCampId + meetSpots: "latest share replaces" semantics.
        // Sender's current intent always wins, because union-merging a
        // stale "Temple @ Tuesday" with a fresh "Playground @ Wed"
        // would leave both on the friend's map confusingly.
        const next: FriendsMap = {
          ...prev,
          [name]: {
            name,
            campIds: [...mergedCamps],
            eventIds: [...mergedEvents],
            ...(mergedArt.size > 0 ? { artIds: [...mergedArt] } : {}),
            importedAt: new Date().toISOString(),
            ...(input.myCampId ? { myCampId: input.myCampId } : {}),
            ...(input.meetSpots && input.meetSpots.length > 0
              ? { meetSpots: input.meetSpots }
              : {}),
          },
        };
        persistFriends(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  const removeFriend = useCallback((name: string) => {
    setFriends((prev) => {
      const { [name]: _, ...rest } = prev;
      persistFriends(storageKey, rest);
      return rest;
    });
  }, [storageKey]);

  const clear = useCallback(() => {
    persistFriends(storageKey, {});
    setFriends({});
  }, [storageKey]);

  /** Returns true when a friend's bag is empty enough to auto-drop. */
  function isEmpty(f: FriendFavs | undefined): boolean {
    if (!f) return true;
    return f.campIds.length === 0
      && f.eventIds.length === 0
      && (f.artIds?.length ?? 0) === 0
      && (f.meetSpots?.length ?? 0) === 0
      && !f.myCampId;
  }

  const removeFriendStar = useCallback(
    (name: string, kind: 'camp' | 'event' | 'art', id: string) => {
      setFriends((prev) => {
        const f = prev[name];
        if (!f) return prev;
        const next: FriendsMap = { ...prev };
        const updated: FriendFavs = { ...f };
        if (kind === 'camp') {
          updated.campIds = f.campIds.filter((x) => x !== id);
        } else if (kind === 'event') {
          updated.eventIds = f.eventIds.filter((x) => x !== id);
        } else {
          // 'art'
          updated.artIds = (f.artIds ?? []).filter((x) => x !== id);
          if (updated.artIds.length === 0) delete updated.artIds;
        }
        if (isEmpty(updated)) {
          delete next[name];
        } else {
          next[name] = updated;
        }
        persistFriends(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  const removeFriendMeetSpot = useCallback(
    (name: string, idx: number) => {
      setFriends((prev) => {
        const f = prev[name];
        if (!f || !f.meetSpots) return prev;
        const next: FriendsMap = { ...prev };
        const updated: FriendFavs = { ...f };
        const remaining = f.meetSpots.filter((_, i) => i !== idx);
        if (remaining.length === 0) delete updated.meetSpots;
        else updated.meetSpots = remaining;
        if (isEmpty(updated)) {
          delete next[name];
        } else {
          next[name] = updated;
        }
        persistFriends(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  // Multi-tab sync — another tab's importFriend / removeFriend writes
  // to the same scoped key and fires `storage` in this tab.
  useEffect(() => {
    const win = typeof window !== 'undefined' ? window : null;
    if (!win) return;
    function onStorage(e: StorageEvent) {
      if (e.key !== null && e.key !== storageKey) return;
      setFriends(loadFriends(storageKey));
    }
    win.addEventListener('storage', onStorage);
    return () => win.removeEventListener('storage', onStorage);
  }, [storageKey]);

  const names = Object.keys(friends);

  const anyFriendFavCamp = useCallback(
    (campId: string) => names.some((n) => friends[n].campIds.includes(campId)),
    [friends, names],
  );
  const anyFriendFavEvent = useCallback(
    (eventId: string) => names.some((n) => friends[n].eventIds.includes(eventId)),
    [friends, names],
  );
  const anyFriendFavArt = useCallback(
    (artId: string) => names.some((n) => (friends[n].artIds ?? []).includes(artId)),
    [friends, names],
  );
  const friendsFavingCamp = useCallback(
    (campId: string) => names.filter((n) => friends[n].campIds.includes(campId)),
    [friends, names],
  );
  const friendsFavingEvent = useCallback(
    (eventId: string) => names.filter((n) => friends[n].eventIds.includes(eventId)),
    [friends, names],
  );
  const friendsFavingArt = useCallback(
    (artId: string) => names.filter((n) => (friends[n].artIds ?? []).includes(artId)),
    [friends, names],
  );

  return {
    friends, names, importFriend, removeFriend, clear,
    removeFriendStar, removeFriendMeetSpot,
    anyFriendFavCamp, anyFriendFavEvent, anyFriendFavArt,
    friendsFavingCamp, friendsFavingEvent, friendsFavingArt,
  };
}
