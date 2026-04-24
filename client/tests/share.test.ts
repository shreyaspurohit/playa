// Share URL encode/decode round-trip. Fragment-based (base64url-of-
// JSON), so no server sees the payload.
import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, teardownDom } from './_dom';
import {
  encodeShare, decodeShare, buildShareUrl,
  readShareFromUrl, clearShareFromUrl,
  MAX_ENCODED_LEN, MAX_NICKNAME_LEN, MAX_IDS,
} from '../src/utils/share';

/** Encode an arbitrary object (not a SharePayload) as a share blob so
 *  tests can feed hostile shapes to the decoder. */
function encodeRaw(obj: unknown): string {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

beforeEach(() => { installDom(); });
afterEach(() => { teardownDom(); });

describe('encode/decode', () => {
  test('round-trips a typical payload', () => {
    const p = {
      name: 'Alice',
      campIds: ['779', '136', '500'],
      eventIds: ['419', '2974'],
    };
    const decoded = decodeShare(encodeShare(p));
    assert.deepEqual(decoded, p);
  });

  test('handles unicode nicknames', () => {
    const p = { name: '🔥 dusty', campIds: ['1'], eventIds: [] };
    assert.deepEqual(decodeShare(encodeShare(p)), p);
  });

  test('handles empty fav lists', () => {
    const p = { name: 'shy', campIds: [], eventIds: [] };
    assert.deepEqual(decodeShare(encodeShare(p)), p);
  });

  test('decode returns null on garbage', () => {
    assert.equal(decodeShare('not-valid-base64!!!'), null);
    assert.equal(decodeShare(''), null);
    // Valid base64 but wrong shape:
    assert.equal(decodeShare('e30'), null); // "{}"
  });

  test('decode rejects payloads with no name', () => {
    // Valid JSON, missing 'n':
    const raw = btoa('{"c":["1"],"e":[]}')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    assert.equal(decodeShare(raw), null);
  });
});

describe('decode — hostile input validation', () => {
  test('rejects oversized encoded input before decoding', () => {
    const oversize = 'a'.repeat(MAX_ENCODED_LEN + 1);
    assert.equal(decodeShare(oversize), null);
  });

  test('rejects non-string / null / undefined input', () => {
    // Callers should pass strings, but be defensive — URL parsing
    // edge cases or manipulated hashes could leak through.
    assert.equal(decodeShare(null as unknown as string), null);
    assert.equal(decodeShare(undefined as unknown as string), null);
    assert.equal(decodeShare(42 as unknown as string), null);
  });

  test('rejects prototype-sentinel nicknames (__proto__, constructor, prototype)', () => {
    for (const n of ['__proto__', 'constructor', 'prototype']) {
      const enc = encodeRaw({ n, c: ['1'], e: [] });
      assert.equal(decodeShare(enc), null, `name "${n}" must be rejected`);
    }
  });

  test('rejects nicknames with control chars / zero-width / bidi overrides', () => {
    // Right-to-left override (U+202E) — classic UI-spoofing vector.
    assert.equal(decodeShare(encodeRaw({ n: 'ali‮ce', c: [], e: [] })), null);
    // Zero-width space.
    assert.equal(decodeShare(encodeRaw({ n: 'al​ice', c: [], e: [] })), null);
    // C0 control.
    assert.equal(decodeShare(encodeRaw({ n: 'alice', c: [], e: [] })), null);
  });

  test('rejects nicknames longer than the hard cap', () => {
    const tooLong = 'x'.repeat(MAX_NICKNAME_LEN + 1);
    assert.equal(decodeShare(encodeRaw({ n: tooLong, c: [], e: [] })), null);
  });

  test('ACCEPTS emoji nicknames (unicode letters + emoji are fine)', () => {
    // The earlier "🔥 dusty" test covers the happy path for emoji; this
    // guards the boundary against an over-zealous BAD_CHARS regex.
    const decoded = decodeShare(encodeRaw({ n: '🔥 Ålíce 3', c: [], e: [] }));
    assert.ok(decoded);
    assert.equal(decoded!.name, '🔥 Ålíce 3');
  });

  test('rejects non-object envelopes (array, primitive)', () => {
    assert.equal(decodeShare(encodeRaw(['a', 'b'])), null);
    assert.equal(decodeShare(encodeRaw(42)), null);
    assert.equal(decodeShare(encodeRaw('oops')), null);
  });

  test('rejects id lists exceeding the per-list cap', () => {
    const huge = Array.from({ length: MAX_IDS + 1 }, (_, i) => String(i));
    const out = decodeShare(encodeRaw({ n: 'alice', c: huge, e: [] }));
    assert.ok(out);
    // Whole-list reject: none of the >MAX_IDS ids slip through.
    assert.deepEqual(out!.campIds, []);
  });

  test('drops individual ids with bad chars, preserves clean ones', () => {
    const out = decodeShare(encodeRaw({
      n: 'alice',
      c: ['779', 'bad id with space', '<script>', '1291', 'a'.repeat(100)],
      e: [],
    }));
    assert.ok(out);
    // Only the two clean numeric ids survive.
    assert.deepEqual(out!.campIds.sort(), ['1291', '779']);
  });

  test('coerces numeric ids, dedupes', () => {
    const out = decodeShare(encodeRaw({
      n: 'alice', c: [779, '779', 1291, '1291'], e: [],
    }));
    assert.ok(out);
    assert.deepEqual(out!.campIds.sort(), ['1291', '779']);
  });

  test('non-array c/e fields produce empty lists, not a crash', () => {
    const out = decodeShare(encodeRaw({ n: 'alice', c: 'nope', e: { wat: 1 } }));
    assert.ok(out);
    assert.deepEqual(out!.campIds, []);
    assert.deepEqual(out!.eventIds, []);
  });
});

describe('URL round-trip', () => {
  test('buildShareUrl + readShareFromUrl recover the payload', () => {
    const p = { name: 'Alice', campIds: ['1', '2'], eventIds: ['99'] };
    const url = buildShareUrl(p);
    // Browser URL simulation: assign to location.hash via the href setter.
    const parsed = new URL(url);
    location.hash = parsed.hash;
    const read = readShareFromUrl();
    assert.deepEqual(read, p);
  });

  test('no share in URL → readShareFromUrl returns null', () => {
    location.hash = '';
    assert.equal(readShareFromUrl(), null);
    location.hash = '#schedule';
    assert.equal(readShareFromUrl(), null);
  });

  test('clearShareFromUrl drops just the share segment', () => {
    const p = { name: 'Alice', campIds: ['1'], eventIds: [] };
    location.hash = '#schedule&share=' + buildShareUrl(p).split('#share=')[1];
    clearShareFromUrl();
    assert.ok(!location.hash.includes('share='));
    // Other fragments (like #schedule) should survive
    assert.ok(location.hash.includes('schedule'));
  });
});
