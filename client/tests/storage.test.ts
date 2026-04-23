// Round-trips and edge cases for our localStorage helpers. happy-dom
// gives us a real Web Storage impl, so we're actually exercising the
// JSON ser/de + fallback behavior.
import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, teardownDom } from './_dom';
import {
  readString, writeString, removeKey,
  readStringSet, writeStringSet,
} from '../src/utils/storage';

beforeEach(() => { installDom(); });
afterEach(() => { teardownDom(); });

describe('readString / writeString', () => {
  test('round-trips a value', () => {
    writeString('k', 'hello');
    assert.equal(readString('k'), 'hello');
  });

  test('returns the fallback when key is absent', () => {
    assert.equal(readString('missing', 'default'), 'default');
  });

  test('returns an empty string by default', () => {
    assert.equal(readString('missing'), '');
  });
});

describe('readStringSet / writeStringSet', () => {
  test('round-trips a Set of strings', () => {
    const a = new Set(['1', '2', '3']);
    writeStringSet('favs', a);
    const b = readStringSet('favs');
    assert.deepEqual([...b].sort(), ['1', '2', '3']);
  });

  test('returns an empty set when missing', () => {
    assert.equal(readStringSet('nope').size, 0);
  });

  test('returns an empty set when stored value is not valid JSON', () => {
    writeString('favs', 'not json{{{');
    assert.equal(readStringSet('favs').size, 0);
  });

  test('returns an empty set when stored value is not an array', () => {
    writeString('favs', '{"not":"an array"}');
    assert.equal(readStringSet('favs').size, 0);
  });

  test('coerces non-string ids to strings on read', () => {
    writeString('favs', JSON.stringify([1, 2, 3]));
    assert.deepEqual([...readStringSet('favs')].sort(), ['1', '2', '3']);
  });
});

describe('removeKey', () => {
  test('removes a stored value', () => {
    writeString('k', 'v');
    removeKey('k');
    assert.equal(readString('k', 'missing'), 'missing');
  });
});
