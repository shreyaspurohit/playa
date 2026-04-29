// Tests for snapshot validation. Same adversarial stance as
// share.test.ts: the JSON file is untrusted input, so verify all the
// reject paths fail closed (return null or drop the field) instead of
// passing through to localStorage.
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, teardownDom } from './_dom';
installDom();
import {
  parseSnapshot, SNAPSHOT_SCHEMA, applySnapshot, buildSnapshot,
} from '../src/utils/exportImport';
import { LS } from '../src/types';
import { writeString, readString } from '../src/utils/storage';

function snap(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: SNAPSHOT_SCHEMA,
    exportedAt: '2026-04-24T16:00:00Z',
    nickname: 'alice',
    campFavs: ['123', '456'],
    eventFavs: ['e1'],
    myCampId: '123',
    meetSpots: [{ label: 'Coffee', address: '9:00 & C', when: 'Tue 9am' }],
    hiddenDays: ['e1|2026-08-27'],
    friends: {},
    ...over,
  });
}

describe('parseSnapshot', () => {
  test('round-trips a clean v1 snapshot', () => {
    const out = parseSnapshot(snap());
    assert.ok(out);
    assert.equal(out!.nickname, 'alice');
    assert.deepEqual(out!.campFavs, ['123', '456']);
    assert.equal(out!.myCampId, '123');
    assert.equal(out!.meetSpots[0].label, 'Coffee');
    assert.deepEqual(out!.hiddenDays, ['e1|2026-08-27']);
  });

  test('rejects wrong schema version', () => {
    assert.equal(parseSnapshot(snap({ schema: 'playa-camps-v0' })), null);
    assert.equal(parseSnapshot(snap({ schema: 'something-else' })), null);
  });

  test('rejects non-JSON', () => {
    assert.equal(parseSnapshot('not json'), null);
    assert.equal(parseSnapshot(''), null);
  });

  test('rejects arrays + primitives at top level', () => {
    assert.equal(parseSnapshot('[]'), null);
    assert.equal(parseSnapshot('"hello"'), null);
    assert.equal(parseSnapshot('42'), null);
  });

  test('rejects oversized payloads before parse', () => {
    const huge = 'x'.repeat(6_000_000);
    assert.equal(parseSnapshot(huge), null);
  });

  test('strips bidi-override / control chars from nickname', () => {
    const bad = parseSnapshot(snap({ nickname: 'al‮ice' }));
    // cleanName returns '' for bad chars; snapshot still parses, name empty.
    assert.equal(bad!.nickname, '');
  });

  test('rejects __proto__ as nickname', () => {
    const out = parseSnapshot(snap({ nickname: '__proto__' }));
    assert.equal(out!.nickname, '');
  });

  test('drops bad ids but keeps good ones', () => {
    const out = parseSnapshot(snap({
      campFavs: ['valid', '../etc', 'also-good', 123, ''],
    }));
    assert.deepEqual(out!.campFavs, ['valid', 'also-good', '123']);
  });

  test('drops malformed hiddenDays entries', () => {
    const out = parseSnapshot(snap({
      hiddenDays: [
        'e1|2026-08-27',     // good
        'e1|not-a-date',     // bad shape
        'something-else',    // missing pipe + date
        123,                 // wrong type
      ],
    }));
    assert.deepEqual(out!.hiddenDays, ['e1|2026-08-27']);
  });

  test('drops friends with malformed entries but keeps good ones', () => {
    const out = parseSnapshot(snap({
      friends: {
        bob: { name: 'bob', campIds: ['1'], eventIds: [] },
        '__proto__': { name: 'evil', campIds: ['2'], eventIds: [] },
      },
    }));
    assert.deepEqual(Object.keys(out!.friends).sort(), ['bob']);
  });

  test('cleans meet-spot label of bidi/control chars by rejecting the entry', () => {
    const out = parseSnapshot(snap({
      meetSpots: [
        { label: 'Coffee‮evil', address: '9:00 & C' },
        { label: 'Tea', address: '8:00 & B' },
      ],
    }));
    assert.equal(out!.meetSpots.length, 1);
    assert.equal(out!.meetSpots[0].label, 'Tea');
  });
});

describe('applySnapshot + buildSnapshot round-trip', () => {
  beforeEach(() => {
    teardownDom();
    installDom();
  });

  test('writes every field to LS and reads it back', () => {
    // Snapshots are now per-source — the round-trip lands in the
    // implicit default `directory` slot (`<base>/directory`).
    const original = parseSnapshot(snap())!;
    applySnapshot(original);
    assert.equal(readString(LS.nickname, ''), 'alice');
    assert.equal(readString(LS.myCampId + '/directory', ''), '123');

    const rebuilt = buildSnapshot();
    assert.equal(rebuilt.nickname, 'alice');
    assert.deepEqual(rebuilt.campFavs.sort(), ['123', '456']);
    assert.equal(rebuilt.meetSpots[0].label, 'Coffee');
    assert.deepEqual(rebuilt.hiddenDays, ['e1|2026-08-27']);
  });

  test('empty state builds a snapshot with all-empty arrays', () => {
    // Don't write anything, just build
    writeString(LS.favs, '');
    const out = buildSnapshot();
    assert.equal(out.schema, SNAPSHOT_SCHEMA);
    assert.deepEqual(out.campFavs, []);
    assert.deepEqual(out.meetSpots, []);
    assert.deepEqual(out.friends, {});
  });
});
