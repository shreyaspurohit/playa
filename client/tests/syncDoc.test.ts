import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, teardownDom } from './_dom';
import { LS, scopedKey } from '../src/types';
import {
  TOMBSTONE_MAX_AGE_MS,
  applySyncDoc,
  emptySyncDoc,
  localToSyncDoc,
  mergeSyncDocs,
  parseSyncDoc,
} from '../src/utils/syncDoc';

describe('cloud sync document', () => {
  beforeEach(() => installDom());
  afterEach(() => teardownDom());

  test('a fresh device creates adds but never infers deletes', () => {
    localStorage.setItem(scopedKey(LS.favs, 'api-2026'), JSON.stringify(['local']));
    const doc = localToSyncDoc(localStorage, ['api-2026'], null, 'device-a', 200);
    assert.equal(doc.sets['favs/api-2026']['missing'], undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(doc.sets['favs/api-2026'])), { local: { t: 200 } });
  });

  test('a known baseline turns a removed favorite into a tombstone', () => {
    const baseline = emptySyncDoc('device-a', 100);
    baseline.sets['favs/api-2026'] = { keep: { t: 100 }, remove: { t: 100 } };
    localStorage.setItem(scopedKey(LS.favs, 'api-2026'), JSON.stringify(['keep']));
    const next = localToSyncDoc(localStorage, ['api-2026'], baseline, 'device-a', 200);
    assert.deepEqual(next.sets['favs/api-2026'].keep, { t: 100 });
    assert.deepEqual(next.sets['favs/api-2026'].remove, { t: 200, del: 1 });
  });

  test('an unchanged local snapshot preserves baseline metadata', () => {
    const baseline = emptySyncDoc('device-a', 100);
    baseline.sets['favs/api-2026'] = { keep: { t: 100 } };
    localStorage.setItem(scopedKey(LS.favs, 'api-2026'), JSON.stringify(['keep']));
    assert.deepEqual(
      JSON.parse(JSON.stringify(localToSyncDoc(
        localStorage, ['api-2026'], baseline, 'device-b', 200,
      ))),
      JSON.parse(JSON.stringify(baseline)),
    );
  });

  test('merge is commutative, idempotent, and active wins an exact tie', () => {
    const a = emptySyncDoc('a', 20);
    const b = emptySyncDoc('b', 20);
    a.sets['favs/api-2026'] = { x: { t: 20, del: 1 } };
    b.sets['favs/api-2026'] = { x: { t: 20 }, y: { t: 19 } };
    a.registers.nickname = { t: 20, v: 'Ada' };
    b.registers.nickname = { t: 20, v: 'Bea' };
    const ab = mergeSyncDocs(a, b, 21);
    const ba = mergeSyncDocs(b, a, 21);
    assert.deepEqual(ab, ba);
    assert.deepEqual(mergeSyncDocs(ab, ab, 21), ab);
    assert.deepEqual(ab.sets['favs/api-2026'].x, { t: 20 });
    assert.equal(ab.registers.nickname.v, 'Bea');
  });

  test('a newer deletion beats an older remote add', () => {
    const local = emptySyncDoc('a', 30);
    const remote = emptySyncDoc('b', 20);
    local.sets['favEvents/api-2026'] = { event: { t: 30, del: 1 } };
    remote.sets['favEvents/api-2026'] = { event: { t: 20 } };
    assert.equal(mergeSyncDocs(local, remote, 31).sets['favEvents/api-2026'].event.del, 1);
  });

  test('meet spots merge per item and a known-baseline removal becomes a tombstone', () => {
    const aStorage = localStorage;
    aStorage.setItem(scopedKey(LS.meetSpots, 'api-2026'), JSON.stringify([
      { label: 'A', address: '6:00 & A' },
    ]));
    const a = localToSyncDoc(aStorage, ['api-2026'], null, 'a', 10);
    aStorage.setItem(scopedKey(LS.meetSpots, 'api-2026'), JSON.stringify([
      { label: 'B', address: '7:00 & B' },
    ]));
    const b = localToSyncDoc(aStorage, ['api-2026'], null, 'b', 20);
    const merged = mergeSyncDocs(a, b, 21);
    applySyncDoc(aStorage, merged);
    assert.deepEqual(
      JSON.parse(aStorage.getItem(scopedKey(LS.meetSpots, 'api-2026'))!).map((s: { label: string }) => s.label).sort(),
      ['A', 'B'],
    );

    aStorage.setItem(scopedKey(LS.meetSpots, 'api-2026'), JSON.stringify([
      { label: 'B', address: '7:00 & B' },
    ]));
    const removed = localToSyncDoc(aStorage, ['api-2026'], merged, 'a', 30);
    const entries = Object.entries(removed.registers)
      .filter(([key]) => key.startsWith('meetSpot/api-2026/'));
    assert.equal(entries.filter(([, entry]) => entry.del === 1).length, 1);
    assert.equal(entries.filter(([, entry]) => entry.del !== 1).length, 1);
  });

  test('old tombstones are garbage collected', () => {
    const doc = emptySyncDoc('a', 1);
    doc.sets['favs/api-2026'] = { old: { t: 1, del: 1 }, live: { t: 1 } };
    const out = mergeSyncDocs(doc, emptySyncDoc('b', 2), TOMBSTONE_MAX_AGE_MS + 2);
    assert.equal(out.sets['favs/api-2026'].old, undefined);
    assert.deepEqual(out.sets['favs/api-2026'].live, { t: 1 });
  });

  test('apply restores every synced field across sources', () => {
    const doc = emptySyncDoc('cloud', 10);
    doc.sets['favs/api-2026'] = { c1: { t: 10 }, c2: { t: 9, del: 1 } };
    doc.sets['favEvents/api-2026'] = { e1: { t: 10 } };
    doc.sets['favArt/api-2026'] = { a1: { t: 10 } };
    doc.sets['hiddenDays/api-2026'] = { 'e1|2026-08-31': { t: 10 } };
    doc.registers.nickname = { t: 10, v: 'Dusty' };
    doc.registers.theme = { t: 10, v: 'night' };
    doc.registers.distanceUnit = { t: 10, v: 'metric' };
    doc.registers.mapLayers = { t: 10, v: ['transport'] };
    doc.registers['myCampId/api-2026'] = { t: 10, v: 'c1' };
    localStorage.setItem(scopedKey(LS.meetSpots, 'api-2026'), JSON.stringify([
      { label: 'Temple', address: '12:00 & Esplanade' },
    ]));
    const spotDoc = localToSyncDoc(localStorage, ['api-2026'], null, 'spot', 10);
    localStorage.removeItem(scopedKey(LS.meetSpots, 'api-2026'));
    Object.assign(doc.registers, spotDoc.registers);
    // "Ada" encoded as UTF-8 base64url.
    doc.registers['sharedFavs/api-2026/QWRh'] = {
      t: 10,
      v: { name: 'Ada', campIds: ['c1'], eventIds: [], importedAt: '2026-08-01T00:00:00Z' },
    };

    assert.equal(applySyncDoc(localStorage, doc), true);
    assert.deepEqual(JSON.parse(localStorage.getItem(scopedKey(LS.favs, 'api-2026'))!), ['c1']);
    assert.deepEqual(JSON.parse(localStorage.getItem(scopedKey(LS.favArt, 'api-2026'))!), ['a1']);
    assert.equal(localStorage.getItem(LS.nickname), 'Dusty');
    assert.equal(localStorage.getItem(LS.theme), 'night');
    assert.equal(localStorage.getItem(scopedKey(LS.myCampId, 'api-2026')), 'c1');
    assert.equal(JSON.parse(localStorage.getItem(scopedKey(LS.sharedFavs, 'api-2026'))!).Ada.name, 'Ada');
    assert.equal(applySyncDoc(localStorage, doc), false);
  });

  test('parser rejects oversized, wrong-schema, prototype and malformed entries', () => {
    assert.equal(parseSyncDoc(''), null);
    assert.equal(parseSyncDoc(JSON.stringify({ schema: 'future' })), null);
    const good = emptySyncDoc('device-a', 10);
    good.sets['favs/api-2026'] = { ok: { t: 10 } };
    assert.deepEqual(
      JSON.parse(JSON.stringify(parseSyncDoc(JSON.stringify(good)))),
      JSON.parse(JSON.stringify(good)),
    );
    const poisoned = JSON.stringify({
      ...good,
      sets: JSON.parse('{"favs/api-2026":{"__proto__":{"t":10}}}'),
    });
    assert.equal(parseSyncDoc(poisoned), null);
    const malformed = { ...good, sets: { 'favs/api-2026': { ok: { t: 'late' } } } };
    assert.equal(parseSyncDoc(JSON.stringify(malformed)), null);
  });
});
