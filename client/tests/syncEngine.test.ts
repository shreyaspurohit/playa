import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, teardownDom } from './_dom';
import { LS, scopedKey } from '../src/types';
import { emptySyncDoc, parseSyncDoc } from '../src/utils/syncDoc';
import { syncOnce } from '../src/sync/syncEngine';
import { SyncConflictError, type RemoteSyncFile, type SyncBackend } from '../src/sync/SyncBackend';

class MemoryBackend implements SyncBackend {
  writes: string[] = [];
  conflictOnce = false;
  constructor(public remote: RemoteSyncFile) {}
  async isConnected() { return true; }
  async authorize() {}
  async beginRedirectAuth() {}
  async completeRedirectAuth() { return false; }
  async disconnect() {}
  async readFile() { return this.remote; }
  async writeFile(text: string, revision: string | null) {
    if (this.conflictOnce) {
      this.conflictOnce = false;
      throw new SyncConflictError();
    }
    this.writes.push(text);
    this.remote = { text, revision: `${revision ?? 'new'}-next` };
    return this.remote.revision!;
  }
}

describe('Dropbox sync orchestration', () => {
  beforeEach(() => installDom());
  afterEach(() => teardownDom());

  test('first connection safely unions local stars and restores cloud state', async () => {
    localStorage.setItem(scopedKey(LS.favs, 'api-2026'), JSON.stringify(['local']));
    const cloud = emptySyncDoc('cloud', 100);
    cloud.sets['favs/api-2026'] = { remote: { t: 100 } };
    cloud.registers.nickname = { t: 100, v: 'Cloud Name' };
    const backend = new MemoryBackend({ text: JSON.stringify(cloud), revision: 'r1' });

    const outcome = await syncOnce(backend, localStorage, ['api-2026'], () => 200);
    assert.equal(outcome.restoredFromCloud, true);
    assert.equal(outcome.localChanged, true);
    assert.deepEqual(
      JSON.parse(localStorage.getItem(scopedKey(LS.favs, 'api-2026'))!).sort(),
      ['local', 'remote'],
    );
    assert.equal(localStorage.getItem(LS.nickname), 'Cloud Name');
    assert.ok(localStorage.getItem(LS.syncBase));
    const uploaded = parseSyncDoc(backend.writes[0]);
    assert.ok(uploaded?.sets['favs/api-2026'].local);
    assert.ok(uploaded?.sets['favs/api-2026'].remote);
  });

  test('local favorite sync does not report a page reload', async () => {
    localStorage.setItem(scopedKey(LS.favs, 'api-2026'), JSON.stringify(['local']));
    const backend = new MemoryBackend({ text: null, revision: null });

    const first = await syncOnce(backend, localStorage, ['api-2026'], () => 100);
    assert.equal(first.localChanged, false);

    localStorage.setItem(scopedKey(LS.favs, 'api-2026'), JSON.stringify(['local', 'new']));
    const second = await syncOnce(backend, localStorage, ['api-2026'], () => 200);
    assert.equal(second.localChanged, false);
    assert.deepEqual(
      JSON.parse(localStorage.getItem(scopedKey(LS.favs, 'api-2026'))!).sort(),
      ['local', 'new'],
    );
  });

  test('api-2026 state survives first Dropbox connect and clean-browser restore', async () => {
    const apiState: Array<[string, string]> = [
      [LS.favs, JSON.stringify(['camp-1', 'camp-2'])],
      [LS.favEvents, JSON.stringify(['event-1'])],
      [LS.sharedFavs, JSON.stringify({
        Alice: {
          name: 'Alice', campIds: ['friend-camp'], eventIds: ['friend-event'],
          importedAt: '2026-08-01T00:00:00Z',
        },
      })],
      [LS.myCampId, 'camp-2'],
      [LS.meetSpots, JSON.stringify([
        { label: 'Temple sunset', address: '12:00 & Esplanade', when: 'Wed' },
      ])],
      [LS.hiddenDays, JSON.stringify(['event-1|2026-08-31'])],
    ];
    for (const [key, value] of apiState) {
      localStorage.setItem(scopedKey(key, 'api-2026'), value);
    }
    localStorage.setItem(scopedKey(LS.favArt, 'api-2026'), JSON.stringify(['art-1']));
    localStorage.setItem(LS.nickname, 'Dusty');
    localStorage.setItem(LS.theme, 'night');
    localStorage.setItem(LS.distanceUnit, 'metric');
    localStorage.setItem(LS.mapLayers, JSON.stringify(['transport', 'toilets']));
    localStorage.setItem('bm-release-note-ack', 'keep-local-only');

    const backend = new MemoryBackend({ text: null, revision: null });
    await syncOnce(backend, localStorage, ['api-2026'], () => 200);
    assert.equal(localStorage.getItem('bm-release-note-ack'), 'keep-local-only');
    assert.ok(parseSyncDoc(backend.remote.text!));

    // A clean second browser restores the cloud copy. This also proves that
    // first connect wrote every API-scoped field rather than merely preserving
    // it in the original browser.
    localStorage.clear();
    await syncOnce(backend, localStorage, ['api-2026'], () => 300);
    assert.deepEqual(JSON.parse(localStorage.getItem(scopedKey(LS.favs, 'api-2026'))!), ['camp-1', 'camp-2']);
    assert.deepEqual(JSON.parse(localStorage.getItem(scopedKey(LS.favEvents, 'api-2026'))!), ['event-1']);
    assert.deepEqual(JSON.parse(localStorage.getItem(scopedKey(LS.favArt, 'api-2026'))!), ['art-1']);
    assert.deepEqual(JSON.parse(localStorage.getItem(scopedKey(LS.hiddenDays, 'api-2026'))!), ['event-1|2026-08-31']);
    assert.equal(localStorage.getItem(scopedKey(LS.myCampId, 'api-2026')), 'camp-2');
    assert.equal(JSON.parse(localStorage.getItem(scopedKey(LS.meetSpots, 'api-2026'))!)[0].label, 'Temple sunset');
    assert.equal(JSON.parse(localStorage.getItem(scopedKey(LS.sharedFavs, 'api-2026'))!).Alice.name, 'Alice');
    assert.equal(localStorage.getItem(LS.nickname), 'Dusty');
    assert.equal(localStorage.getItem(LS.theme), 'night');
    assert.equal(localStorage.getItem(LS.distanceUnit), 'metric');
    assert.deepEqual(JSON.parse(localStorage.getItem(LS.mapLayers)!), ['transport', 'toilets']);
  });

  test('first connection unions distinct local and cloud meet spots', async () => {
    localStorage.setItem(scopedKey(LS.meetSpots, 'api-2026'), JSON.stringify([
      { label: 'Local tea', address: '7:00 & B' },
    ]));
    const cloud = emptySyncDoc('cloud', 100);
    // Legacy whole-list shape verifies transparent migration too.
    cloud.registers['meetSpots/api-2026'] = {
      t: 100, v: [{ label: 'Cloud coffee', address: '9:00 & C', when: 'Tue' }],
    };
    const backend = new MemoryBackend({ text: JSON.stringify(cloud), revision: 'r1' });

    await syncOnce(backend, localStorage, ['api-2026'], () => 200);
    const spots = JSON.parse(localStorage.getItem(scopedKey(LS.meetSpots, 'api-2026'))!);
    assert.deepEqual(spots.map((spot: { label: string }) => spot.label).sort(), [
      'Cloud coffee', 'Local tea',
    ]);
    const uploaded = parseSyncDoc(backend.writes[0]);
    assert.ok(uploaded);
    assert.equal(Object.keys(uploaded.registers).filter((key) => key.startsWith('meetSpot/')).length, 2);
    assert.equal(uploaded.registers['meetSpots/api-2026'], undefined);
  });

  test('optimistic conflict re-reads and retries', async () => {
    localStorage.setItem(scopedKey(LS.favs, 'api-2026'), JSON.stringify(['one']));
    const backend = new MemoryBackend({ text: null, revision: null });
    backend.conflictOnce = true;
    const outcome = await syncOnce(backend, localStorage, ['api-2026'], () => 200);
    assert.equal(outcome.localChanged, false);
    assert.equal(backend.writes.length, 1);
  });

  test('invalid cloud data never changes local state', async () => {
    localStorage.setItem(scopedKey(LS.favs, 'api-2026'), JSON.stringify(['safe']));
    const backend = new MemoryBackend({ text: '{"schema":"unknown"}', revision: 'r1' });
    await assert.rejects(() => syncOnce(backend, localStorage, ['api-2026']), /not a valid/);
    assert.deepEqual(JSON.parse(localStorage.getItem(scopedKey(LS.favs, 'api-2026'))!), ['safe']);
    assert.equal(backend.writes.length, 0);
  });

  test('a foreground check skips upload when local and cloud are unchanged', async () => {
    const cloud = emptySyncDoc('device-a', 100);
    cloud.sets['favs/api-2026'] = { keep: { t: 100 } };
    localStorage.setItem(scopedKey(LS.favs, 'api-2026'), JSON.stringify(['keep']));
    localStorage.setItem(LS.syncBase, JSON.stringify(cloud));
    const backend = new MemoryBackend({ text: JSON.stringify(cloud), revision: 'r1' });

    const outcome = await syncOnce(backend, localStorage, ['api-2026'], () => 200);
    assert.deepEqual(outcome, { localChanged: false, restoredFromCloud: false });
    assert.equal(backend.writes.length, 0);
  });
});
