// Distinct current-year camp/art location release gates (ADR D8).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLocationEmbargo, isLocationEmbargoed, maskLocation,
} from '../src/utils/embargo';
import type { Camp } from '../src/types';

const POLICY = {
  year: 2026,
  campReleaseAt: '2026-08-23T00:00:00-07:00',
  artReleaseAt: '2026-08-30T00:00:00-07:00',
};

function mkCamp(over: Partial<Camp> = {}): Camp {
  return {
    id: '1', name: 'X', location: '6:00 & A',
    description: '', website: '', url: '', tags: [], events: [],
    ...over,
  };
}

describe('isLocationEmbargoed', () => {
  test('directory is never embargoed', () => {
    assert.equal(
      isLocationEmbargoed('directory', POLICY, 'camp', new Date('2026-08-01T00:00:00Z')),
      false,
    );
  });

  test('camp locations lift at Pacific midnight on August 23', () => {
    assert.equal(
      isLocationEmbargoed('api-2026', POLICY, 'camp', new Date('2026-08-23T06:59:59Z')),
      true,
    );
    assert.equal(
      isLocationEmbargoed('api-2026', POLICY, 'camp', new Date('2026-08-23T07:00:00Z')),
      false,
    );
  });

  test('art remains hidden for the extra week until gate-open', () => {
    assert.equal(
      isLocationEmbargoed('api-2026', POLICY, 'art', new Date('2026-08-23T07:00:00Z')),
      true,
    );
    assert.equal(
      isLocationEmbargoed('api-2026', POLICY, 'art', new Date('2026-08-30T06:59:59Z')),
      true,
    );
    assert.equal(
      isLocationEmbargoed('api-2026', POLICY, 'art', new Date('2026-08-30T07:00:00Z')),
      false,
    );
  });

  test('past years pass through; future years fail closed', () => {
    assert.equal(
      isLocationEmbargoed('api-2025', POLICY, 'camp', new Date('2026-08-01T00:00:00Z')),
      false,
    );
    assert.equal(
      isLocationEmbargoed('api-2027', POLICY, 'camp', new Date('2026-09-01T00:00:00Z')),
      true,
    );
  });

  test('missing or malformed current-year policy fails closed', () => {
    assert.equal(
      isLocationEmbargoed(
        'api-2026', { ...POLICY, campReleaseAt: '' }, 'camp',
        new Date('2026-08-01T00:00:00Z'),
      ),
      true,
    );
    assert.equal(
      isLocationEmbargoed(
        'api-2026', { ...POLICY, year: Number.NaN }, 'camp',
        new Date('2026-08-01T00:00:00Z'),
      ),
      true,
    );
  });

  test('trusted god-mode bypasses both location cutoffs', () => {
    for (const kind of ['camp', 'art'] as const) {
      assert.equal(
        isLocationEmbargoed(
          'api-2026', POLICY, kind, new Date('2026-08-09T07:00:00Z'), true,
        ),
        false,
      );
    }
  });
});

describe('maskLocation', () => {
  test('masks current-year camp fields before the camp release', () => {
    assert.equal(
      maskLocation(
        '6:00 & A', 'api-2026', POLICY, new Date('2026-08-22T12:00:00Z'),
      ),
      '',
    );
  });

  test('passes through after the camp release', () => {
    assert.equal(
      maskLocation(
        '6:00 & A', 'api-2026', POLICY, new Date('2026-08-23T07:00:00Z'),
      ),
      '6:00 & A',
    );
  });
});

describe('applyLocationEmbargo', () => {
  test('clears every camp location without mutating the input', () => {
    const camps = [
      mkCamp({ id: '1', location: '6:00 & A' }),
      mkCamp({ id: '2', location: '7:30 & E' }),
    ];
    const out = applyLocationEmbargo(
      camps, 'api-2026', POLICY, new Date('2026-08-22T12:00:00Z'),
    );
    assert.deepEqual(out.map((camp) => camp.location), ['', '']);
    assert.equal(camps[0].location, '6:00 & A');
  });

  test('returns the identical array when inactive or trusted', () => {
    const camps = [mkCamp()];
    assert.equal(
      applyLocationEmbargo(
        camps, 'directory', POLICY, new Date('2026-08-01T00:00:00Z'),
      ),
      camps,
    );
    assert.equal(
      applyLocationEmbargo(
        camps, 'api-2026', POLICY, new Date('2026-08-01T00:00:00Z'), true,
      ),
      camps,
    );
  });
});
