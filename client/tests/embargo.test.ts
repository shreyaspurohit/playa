// Pre-burn location embargo (ADR D8 / BM API ToS §6.2).
// Verifies the source × date matrix that decides whether
// `camp.location` should be hidden from the UI.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLocationEmbargo, isLocationEmbargoed, maskLocation,
} from '../src/utils/embargo';
import type { Camp } from '../src/types';

const BURN = '2026-08-30';   // gate-open day used in tests below

function fixedDate(iso: string): Date {
  return new Date(iso);
}

function mkCamp(over: Partial<Camp> = {}): Camp {
  return {
    id: '1', name: 'X', location: '6:00 & A',
    description: '', website: '', url: '',
    tags: [], events: [],
    ...over,
  };
}

describe('isLocationEmbargoed', () => {
  test('directory: never embargoed', () => {
    assert.equal(
      isLocationEmbargoed('directory', BURN, fixedDate('2026-04-30T00:00:00Z')),
      false,
    );
    assert.equal(
      isLocationEmbargoed('directory', BURN, fixedDate('2026-09-01T00:00:00Z')),
      false,
    );
  });

  test('api-current-year + before burn-start → embargoed', () => {
    assert.equal(
      isLocationEmbargoed('api-2026', BURN, fixedDate('2026-04-30T00:00:00Z')),
      true,
    );
    // Even just before the cutoff (Aug 29 23:59 UTC).
    assert.equal(
      isLocationEmbargoed('api-2026', BURN, fixedDate('2026-08-29T23:59:00Z')),
      true,
    );
  });

  test('api-current-year on burn-start day at midnight → not embargoed', () => {
    assert.equal(
      isLocationEmbargoed('api-2026', BURN, fixedDate('2026-08-30T00:00:00Z')),
      false,
    );
  });

  test('api-current-year after burn-start → not embargoed', () => {
    assert.equal(
      isLocationEmbargoed('api-2026', BURN, fixedDate('2026-09-01T12:00:00Z')),
      false,
    );
  });

  test('past-year API: never embargoed (post-burn data)', () => {
    assert.equal(
      isLocationEmbargoed('api-2025', BURN, fixedDate('2026-04-30T00:00:00Z')),
      false,
    );
    assert.equal(
      isLocationEmbargoed('api-2024', BURN, fixedDate('2026-04-30T00:00:00Z')),
      false,
    );
  });

  test('future-year API: not embargoed (only matches configured burn year)', () => {
    // Operator hasn't bumped burn_start to 2027 yet — api-2027 isn't
    // the "current burn year" yet.
    assert.equal(
      isLocationEmbargoed('api-2027', BURN, fixedDate('2026-04-30T00:00:00Z')),
      false,
    );
  });

  test('empty / missing burnStart → not embargoed (defensive)', () => {
    assert.equal(
      isLocationEmbargoed('api-2026', '', fixedDate('2026-04-30T00:00:00Z')),
      false,
    );
  });

  test('malformed burnStart → not embargoed (no crash)', () => {
    assert.equal(
      isLocationEmbargoed('api-2026', 'not-a-date', fixedDate('2026-04-30T00:00:00Z')),
      false,
    );
  });

  test('trusted (god-mode) bypasses the embargo even when otherwise active', () => {
    // Without trusted: pre-burn api-2026 → embargoed.
    assert.equal(
      isLocationEmbargoed('api-2026', BURN, fixedDate('2026-04-30T00:00:00Z'), false),
      true,
    );
    // With trusted: same inputs → bypassed.
    assert.equal(
      isLocationEmbargoed('api-2026', BURN, fixedDate('2026-04-30T00:00:00Z'), true),
      false,
    );
  });
});

describe('maskLocation', () => {
  test('returns empty string when embargo is active', () => {
    assert.equal(
      maskLocation('6:00 & A', 'api-2026', BURN, fixedDate('2026-04-30T00:00:00Z')),
      '',
    );
  });

  test('passes through when embargo is inactive', () => {
    assert.equal(
      maskLocation('6:00 & A', 'directory', BURN, fixedDate('2026-04-30T00:00:00Z')),
      '6:00 & A',
    );
    assert.equal(
      maskLocation('6:00 & A', 'api-2026', BURN, fixedDate('2026-09-01T00:00:00Z')),
      '6:00 & A',
    );
  });
});

describe('applyLocationEmbargo', () => {
  test('clears location on every camp when embargo active', () => {
    const camps = [
      mkCamp({ id: '1', location: '6:00 & A' }),
      mkCamp({ id: '2', location: '7:30 & E' }),
    ];
    const out = applyLocationEmbargo(
      camps, 'api-2026', BURN, fixedDate('2026-04-30T00:00:00Z'),
    );
    assert.equal(out[0].location, '');
    assert.equal(out[1].location, '');
    // Other fields preserved.
    assert.equal(out[0].id, '1');
    assert.equal(out[1].name, 'X');
  });

  test('returns identical reference (no clone) when embargo inactive', () => {
    const camps = [mkCamp()];
    const out = applyLocationEmbargo(
      camps, 'directory', BURN, fixedDate('2026-04-30T00:00:00Z'),
    );
    assert.equal(out, camps);    // same array, no copy
  });

  test('does not mutate the input array', () => {
    const camps = [mkCamp({ location: 'original' })];
    applyLocationEmbargo(
      camps, 'api-2026', BURN, fixedDate('2026-04-30T00:00:00Z'),
    );
    // Source array preserved — mask returns a clone.
    assert.equal(camps[0].location, 'original');
  });

  test('trusted=true bypasses masking, returns identical reference', () => {
    const camps = [
      mkCamp({ id: '1', location: '6:00 & A' }),
      mkCamp({ id: '2', location: '7:30 & E' }),
    ];
    const out = applyLocationEmbargo(
      camps, 'api-2026', BURN, fixedDate('2026-04-30T00:00:00Z'), true,
    );
    // No clone, no masking — god-mode users see real locations.
    assert.equal(out, camps);
    assert.equal(out[0].location, '6:00 & A');
    assert.equal(out[1].location, '7:30 & E');
  });
});
