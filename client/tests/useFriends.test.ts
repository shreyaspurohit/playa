// Hook tests for useFriends — covers the four operations the rest of
// the app actually relies on:
//   - importFriend (merge vs overwrite, plus the latest-wins
//     semantics for myCampId + meetSpots).
//   - removeFriend / clear.
//   - the four lookup helpers (anyFriend*, friendsFav*).
//   - cross-tab storage-event listener.
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { h, render } from 'preact';
import { installDom, teardownDom } from './_dom';
import { useFriends, type FriendsApi } from '../src/hooks/useFriends';
import type { FriendFavs } from '../src/types';
import { LS } from '../src/types';

let api: FriendsApi | null = null;
let mountpoint: HTMLElement;

// Tests run with a fixed scoped key — `useFriends` doesn't care which
// source it points at, only that the key is per-source-stable.
const TEST_KEY = LS.sharedFavs + '/directory';

function Harness(): null {
  api = useFriends(TEST_KEY);
  return null;
}

beforeEach(() => {
  installDom();
  try { localStorage.clear(); } catch { /* ignore */ }
  mountpoint = document.createElement('div');
  document.body.appendChild(mountpoint);
  render(h(Harness, {}), mountpoint);
});

afterEach(() => {
  try { render(null, mountpoint); } catch { /* ignore */ }
  api = null;
  teardownDom();
});

function rerender() {
  render(h(Harness, {}), mountpoint);
}

describe('useFriends — basics', () => {
  test('starts empty when no prior data', () => {
    assert.deepEqual(api!.names, []);
    assert.deepEqual(api!.friends, {});
  });

  test('importFriend adds a brand-new entry', () => {
    api!.importFriend('alice', { campIds: ['1', '2'], eventIds: ['e1'] });
    rerender();
    assert.deepEqual(api!.names, ['alice']);
    assert.deepEqual(api!.friends.alice.campIds.sort(), ['1', '2']);
    assert.deepEqual(api!.friends.alice.eventIds, ['e1']);
    assert.equal(api!.friends.alice.name, 'alice');
    // importedAt is an ISO timestamp.
    assert.match(api!.friends.alice.importedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  test('persists to localStorage so other tabs see it', () => {
    api!.importFriend('alice', { campIds: ['1'], eventIds: [] });
    rerender();
    const stored = JSON.parse(localStorage.getItem(TEST_KEY) ?? '{}');
    assert.ok(stored.alice);
    assert.deepEqual(stored.alice.campIds, ['1']);
  });

  test('loads prior friends from localStorage on mount', () => {
    // Seed before mounting a fresh tree.
    const seeded: Record<string, FriendFavs> = {
      bob: {
        name: 'bob',
        campIds: ['100', '200'],
        eventIds: ['ex'],
        importedAt: '2026-04-26T12:00:00Z',
      },
    };
    localStorage.setItem(TEST_KEY, JSON.stringify(seeded));
    const fresh = document.createElement('div');
    document.body.appendChild(fresh);
    render(h(Harness, {}), fresh);
    assert.deepEqual(api!.names, ['bob']);
    assert.deepEqual(api!.friends.bob.campIds.sort(), ['100', '200']);
  });
});

describe('useFriends — import modes', () => {
  test("merge mode (default) unions a friend's camp + event ids", () => {
    api!.importFriend('alice', { campIds: ['1', '2'], eventIds: ['e1'] });
    rerender();
    api!.importFriend('alice', { campIds: ['2', '3'], eventIds: ['e2'] });
    rerender();
    assert.deepEqual(api!.friends.alice.campIds.sort(), ['1', '2', '3']);
    assert.deepEqual(api!.friends.alice.eventIds.sort(), ['e1', 'e2']);
  });

  test('overwrite mode replaces the existing entry outright', () => {
    api!.importFriend('alice', { campIds: ['1', '2'], eventIds: ['e1'] });
    rerender();
    api!.importFriend(
      'alice', { campIds: ['9'], eventIds: ['e9'] }, 'overwrite',
    );
    rerender();
    assert.deepEqual(api!.friends.alice.campIds, ['9']);
    assert.deepEqual(api!.friends.alice.eventIds, ['e9']);
  });

  test('myCampId follows latest-wins (not merge) regardless of mode', () => {
    api!.importFriend('alice', {
      campIds: [], eventIds: [], myCampId: 'A',
    });
    rerender();
    api!.importFriend('alice', {
      campIds: [], eventIds: [], myCampId: 'B',
    });
    rerender();
    assert.equal(api!.friends.alice.myCampId, 'B');
  });

  test('meetSpots are replaced wholesale on each import', () => {
    api!.importFriend('alice', {
      campIds: [], eventIds: [],
      meetSpots: [{ label: 'Coffee', address: '6:00 & C' }],
    });
    rerender();
    api!.importFriend('alice', {
      campIds: [], eventIds: [],
      meetSpots: [{ label: 'Tea', address: '8:00 & B' }],
    });
    rerender();
    assert.equal(api!.friends.alice.meetSpots?.length, 1);
    assert.equal(api!.friends.alice.meetSpots?.[0].label, 'Tea');
  });

  test('importing without meetSpots/myCampId leaves earlier values alone in merge', () => {
    api!.importFriend('alice', {
      campIds: ['1'], eventIds: [], myCampId: 'home',
      meetSpots: [{ label: 'spot', address: '7:00 & D' }],
    });
    rerender();
    // Second import only adds favs — myCampId/meetSpots not present.
    api!.importFriend('alice', { campIds: ['2'], eventIds: [] });
    rerender();
    // Per current semantics (latest-wins on the SHARE), the second
    // share replaces myCampId/meetSpots with undefined → they're
    // dropped. Verifies "stale plans don't linger."
    assert.equal(api!.friends.alice.myCampId, undefined);
    assert.equal(api!.friends.alice.meetSpots, undefined);
  });
});

describe('useFriends — remove + clear', () => {
  test('removeFriend deletes one entry, leaves the rest', () => {
    api!.importFriend('alice', { campIds: ['1'], eventIds: [] });
    api!.importFriend('bob', { campIds: ['2'], eventIds: [] });
    rerender();
    api!.removeFriend('alice');
    rerender();
    assert.deepEqual(api!.names, ['bob']);
    assert.equal(api!.friends.alice, undefined);
  });

  test('clear empties the friends map', () => {
    api!.importFriend('alice', { campIds: ['1'], eventIds: [] });
    api!.importFriend('bob', { campIds: ['2'], eventIds: [] });
    rerender();
    api!.clear();
    rerender();
    assert.deepEqual(api!.names, []);
    assert.deepEqual(api!.friends, {});
    assert.equal(localStorage.getItem(TEST_KEY), '{}');
  });
});

describe('useFriends — per-item star removal', () => {
  test('removeFriendStar(camp) drops one id, keeps the rest', () => {
    api!.importFriend('alice', { campIds: ['1', '2', '3'], eventIds: ['e1'] });
    rerender();
    api!.removeFriendStar('alice', 'camp', '2');
    rerender();
    assert.deepEqual(api!.friends.alice.campIds.sort(), ['1', '3']);
    assert.deepEqual(api!.friends.alice.eventIds, ['e1']);
  });

  test('removeFriendStar(event) drops one id without touching camps', () => {
    api!.importFriend('alice', { campIds: ['1'], eventIds: ['e1', 'e2'] });
    rerender();
    api!.removeFriendStar('alice', 'event', 'e1');
    rerender();
    assert.deepEqual(api!.friends.alice.eventIds, ['e2']);
    assert.deepEqual(api!.friends.alice.campIds, ['1']);
  });

  test('removeFriendStar(art) drops one id and clears the artIds array when emptied', () => {
    api!.importFriend('alice', {
      campIds: ['1'], eventIds: [], artIds: ['a1'],
    });
    rerender();
    api!.removeFriendStar('alice', 'art', 'a1');
    rerender();
    // artIds should be deleted (not [] left behind), so isEmpty()
    // sees a clean shape and the friend stays alive (campIds non-empty).
    assert.equal(api!.friends.alice.artIds, undefined);
    assert.deepEqual(api!.friends.alice.campIds, ['1']);
  });

  test('removing the last item auto-drops the friend entirely', () => {
    api!.importFriend('alice', { campIds: ['1'], eventIds: [] });
    api!.importFriend('bob', { campIds: ['2'], eventIds: [] });
    rerender();
    // Alice's only star — removing it should evict her.
    api!.removeFriendStar('alice', 'camp', '1');
    rerender();
    assert.equal(api!.friends.alice, undefined);
    assert.deepEqual(api!.names, ['bob']);
  });

  test('auto-drop respects myCampId / meetSpots — friend stays even when stars empty', () => {
    api!.importFriend('alice', {
      campIds: ['1'], eventIds: [],
      myCampId: 'home',
    });
    rerender();
    api!.removeFriendStar('alice', 'camp', '1');
    rerender();
    // myCampId keeps her around even with no campIds left.
    assert.deepEqual(api!.friends.alice.campIds, []);
    assert.equal(api!.friends.alice.myCampId, 'home');
  });

  test('removeFriendStar on unknown friend is a no-op', () => {
    api!.importFriend('alice', { campIds: ['1'], eventIds: [] });
    rerender();
    api!.removeFriendStar('nobody', 'camp', '1');
    rerender();
    assert.deepEqual(api!.names, ['alice']);
    assert.deepEqual(api!.friends.alice.campIds, ['1']);
  });

  test('removeFriendStar with an id that doesn\'t exist is a no-op on data', () => {
    api!.importFriend('alice', { campIds: ['1'], eventIds: [] });
    rerender();
    api!.removeFriendStar('alice', 'camp', '999');
    rerender();
    assert.deepEqual(api!.friends.alice.campIds, ['1']);
  });

  test('removeFriendMeetSpot drops one spot by index', () => {
    const spots = [
      { label: 'A', address: '6:00 & C', when: 'mon' },
      { label: 'B', address: '7:00 & D', when: 'tue' },
      { label: 'C', address: '8:00 & E', when: 'wed' },
    ];
    api!.importFriend('alice', {
      campIds: ['1'], eventIds: [], meetSpots: spots,
    });
    rerender();
    api!.removeFriendMeetSpot('alice', 1);  // remove "B"
    rerender();
    const remaining = api!.friends.alice.meetSpots ?? [];
    assert.equal(remaining.length, 2);
    assert.deepEqual(remaining.map((s) => s.label), ['A', 'C']);
  });

  test('removing the last meetSpot clears the array (not [] left behind)', () => {
    const spots = [{ label: 'A', address: '6:00 & C', when: 'mon' }];
    api!.importFriend('alice', {
      campIds: ['1'], eventIds: [], meetSpots: spots,
    });
    rerender();
    api!.removeFriendMeetSpot('alice', 0);
    rerender();
    assert.equal(api!.friends.alice.meetSpots, undefined);
    // Friend stays — campIds keep her alive.
    assert.deepEqual(api!.friends.alice.campIds, ['1']);
  });

  test('removeFriendMeetSpot evicts the friend when meetSpots was the only payload', () => {
    const spots = [{ label: 'A', address: '6:00 & C', when: 'mon' }];
    api!.importFriend('alice', {
      campIds: [], eventIds: [], meetSpots: spots,
    });
    rerender();
    api!.removeFriendMeetSpot('alice', 0);
    rerender();
    assert.equal(api!.friends.alice, undefined);
  });

  test('removeFriendMeetSpot on a friend with no meetSpots is a no-op', () => {
    api!.importFriend('alice', { campIds: ['1'], eventIds: [] });
    rerender();
    api!.removeFriendMeetSpot('alice', 0);
    rerender();
    assert.deepEqual(api!.friends.alice.campIds, ['1']);
  });
});

describe('useFriends — lookup helpers', () => {
  beforeEach(() => {
    api!.importFriend('alice', { campIds: ['1', '2'], eventIds: ['e1'] });
    api!.importFriend('bob',   { campIds: ['2', '3'], eventIds: ['e2', 'e1'] });
    rerender();
  });

  test('anyFriendFavCamp', () => {
    assert.equal(api!.anyFriendFavCamp('1'), true);   // alice only
    assert.equal(api!.anyFriendFavCamp('2'), true);   // both
    assert.equal(api!.anyFriendFavCamp('3'), true);   // bob only
    assert.equal(api!.anyFriendFavCamp('99'), false);
  });

  test('anyFriendFavEvent', () => {
    assert.equal(api!.anyFriendFavEvent('e1'), true);
    assert.equal(api!.anyFriendFavEvent('e2'), true);
    assert.equal(api!.anyFriendFavEvent('e99'), false);
  });

  test('friendsFavingCamp returns the names', () => {
    assert.deepEqual(api!.friendsFavingCamp('1').sort(), ['alice']);
    assert.deepEqual(api!.friendsFavingCamp('2').sort(), ['alice', 'bob']);
    assert.deepEqual(api!.friendsFavingCamp('99'), []);
  });

  test('friendsFavingEvent returns the names', () => {
    assert.deepEqual(api!.friendsFavingEvent('e1').sort(), ['alice', 'bob']);
    assert.deepEqual(api!.friendsFavingEvent('e2'), ['bob']);
  });
});

describe('useFriends — multi-tab sync via storage events', () => {
  // Effects in Preact are deferred — let them attach before we
  // dispatch the synthetic event the listener is supposed to catch.
  async function flushEffects() {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  test('foreign storage write to LS.sharedFavs updates state', async () => {
    await flushEffects();
    rerender();
    await flushEffects();
    // Simulate another tab persisting a friend, then firing the
    // `storage` event the browser would naturally fire on this tab.
    const updated: Record<string, FriendFavs> = {
      carol: {
        name: 'carol',
        campIds: ['x', 'y'],
        eventIds: [],
        importedAt: '2026-04-26T12:00:00Z',
      },
    };
    localStorage.setItem(TEST_KEY, JSON.stringify(updated));
    const evt = new (window as unknown as { StorageEvent: typeof StorageEvent }).StorageEvent('storage', {
      key: TEST_KEY,
      newValue: JSON.stringify(updated),
      storageArea: localStorage,
    } as StorageEventInit);
    window.dispatchEvent(evt);
    rerender();
    assert.deepEqual(api!.names, ['carol']);
  });

  test('storage event for an unrelated key is ignored', async () => {
    await flushEffects();
    rerender();
    await flushEffects();
    api!.importFriend('alice', { campIds: ['1'], eventIds: [] });
    rerender();
    const evt = new (window as unknown as { StorageEvent: typeof StorageEvent }).StorageEvent('storage', {
      key: 'something-else',
      newValue: 'whatever',
      storageArea: localStorage,
    } as StorageEventInit);
    window.dispatchEvent(evt);
    rerender();
    // Alice should still be there, untouched.
    assert.deepEqual(api!.names, ['alice']);
  });
});
