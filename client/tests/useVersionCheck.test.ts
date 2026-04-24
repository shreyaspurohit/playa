// Tests for the version-comparison helpers in useVersionCheck.
// The hook itself is timer + DOM heavy and harder to exercise in
// happy-dom; the comparison logic is the only piece worth pinning,
// since "no banner on rollback" is the user-visible promise.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { isNewer, parseVersion } from '../src/hooks/useVersionCheck';

describe('parseVersion', () => {
  test('strips leading v and parses each component', () => {
    assert.deepEqual(parseVersion('v2026.04.24'), [2026, 4, 24]);
  });

  test('parses the four-segment HHMM form', () => {
    assert.deepEqual(parseVersion('v2026.04.24.1715'), [2026, 4, 24, 1715]);
  });

  test('returns [] for empty / whitespace input', () => {
    assert.deepEqual(parseVersion(''), []);
    assert.deepEqual(parseVersion('   '), []);
  });

  test('non-numeric components fall back to 0 instead of NaN', () => {
    // Defensive against a malformed version.txt — we'd rather under-
    // report than crash the polling loop with NaN comparisons.
    assert.deepEqual(parseVersion('v2026.beta.24'), [2026, 0, 24]);
  });
});

describe('isNewer', () => {
  test('newer minute on the same day → true', () => {
    assert.equal(isNewer('v2026.04.24.1715', 'v2026.04.24.1700'), true);
  });

  test('newer day → true', () => {
    assert.equal(isNewer('v2026.04.25.0900', 'v2026.04.24.2359'), true);
  });

  test('older day → false (rollback case — no banner)', () => {
    assert.equal(isNewer('v2026.04.23.1200', 'v2026.04.24.0900'), false);
  });

  test('equal versions → false (no banner when in sync)', () => {
    assert.equal(isNewer('v2026.04.24.1715', 'v2026.04.24.1715'), false);
  });

  test('legacy 3-segment vs 4-segment on same date → 4-segment wins', () => {
    // After bumping the format, an old client carrying v2026.04.24
    // should still see v2026.04.24.0001 as newer.
    assert.equal(isNewer('v2026.04.24.0001', 'v2026.04.24'), true);
  });

  test('legacy 3-segment newer day vs 4-segment older day', () => {
    assert.equal(isNewer('v2026.04.25', 'v2026.04.24.2359'), true);
  });

  test('handles missing v prefix on either side', () => {
    assert.equal(isNewer('2026.04.25', 'v2026.04.24'), true);
    assert.equal(isNewer('v2026.04.25', '2026.04.24'), true);
  });
});
