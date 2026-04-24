// Friends = other people's imported favorites. We keep them separate
// from `bm-favs` / `bm-fav-events` (which are always YOU) so the fav
// filter can surface "who starred this" per camp.
import { useCallback, useState } from 'preact/hooks';
import type { FriendFavs, MeetSpot } from '../types';
import { LS } from '../types';
import { readString, writeString } from '../utils/storage';

/** Options bag for importFriend. Keeps the call site readable as the
 *  payload grows — today it's campIds/eventIds/myCampId/meetSpots. */
export interface ImportFriendInput {
  campIds: string[];
  eventIds: string[];
  myCampId?: string;
  meetSpots?: MeetSpot[];
}

type FriendsMap = Record<string, FriendFavs>;

function loadFriends(): FriendsMap {
  try {
    const raw = readString(LS.sharedFavs, '');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as FriendsMap;
  } catch { /* bad JSON */ }
  return {};
}

function persistFriends(friends: FriendsMap): void {
  writeString(LS.sharedFavs, JSON.stringify(friends));
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
  /** Any friend fav'd this camp? (used by the filter). */
  anyFriendFavCamp: (campId: string) => boolean;
  /** Any friend fav'd this event? */
  anyFriendFavEvent: (eventId: string) => boolean;
  /** Names of friends who fav'd this camp. */
  friendsFavingCamp: (campId: string) => string[];
  /** Names of friends who fav'd this event. */
  friendsFavingEvent: (eventId: string) => string[];
}

export function useFriends(): FriendsApi {
  const [friends, setFriends] = useState<FriendsMap>(loadFriends);

  const importFriend = useCallback(
    (
      name: string, input: ImportFriendInput,
      mode: 'merge' | 'overwrite' = 'merge',
    ) => {
      setFriends((prev) => {
        const existing = prev[name];
        const baseCamps  = mode === 'overwrite' || !existing ? [] : existing.campIds;
        const baseEvents = mode === 'overwrite' || !existing ? [] : existing.eventIds;
        const mergedCamps = new Set<string>(baseCamps);
        input.campIds.forEach((id) => mergedCamps.add(String(id)));
        const mergedEvents = new Set<string>(baseEvents);
        input.eventIds.forEach((id) => mergedEvents.add(String(id)));
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
            importedAt: new Date().toISOString(),
            ...(input.myCampId ? { myCampId: input.myCampId } : {}),
            ...(input.meetSpots && input.meetSpots.length > 0
              ? { meetSpots: input.meetSpots }
              : {}),
          },
        };
        persistFriends(next);
        return next;
      });
    },
    [],
  );

  const removeFriend = useCallback((name: string) => {
    setFriends((prev) => {
      const { [name]: _, ...rest } = prev;
      persistFriends(rest);
      return rest;
    });
  }, []);

  const clear = useCallback(() => {
    persistFriends({});
    setFriends({});
  }, []);

  const names = Object.keys(friends);

  const anyFriendFavCamp = useCallback(
    (campId: string) => names.some((n) => friends[n].campIds.includes(campId)),
    [friends, names],
  );
  const anyFriendFavEvent = useCallback(
    (eventId: string) => names.some((n) => friends[n].eventIds.includes(eventId)),
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

  return {
    friends, names, importFriend, removeFriend, clear,
    anyFriendFavCamp, anyFriendFavEvent, friendsFavingCamp, friendsFavingEvent,
  };
}
