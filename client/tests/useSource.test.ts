import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, teardownDom } from './_dom';
import {
  availableSources, brcForSource, sourceForDisplay, yearForSource,
} from '../src/hooks/useSource';

beforeEach(() => { installDom(); });
afterEach(() => { teardownDom(); });

describe('sourceForDisplay', () => {
  test('keeps a selected source that is available', () => {
    assert.equal(
      sourceForDisplay('api-2025', ['api-2025', 'api-2026']),
      'api-2025',
    );
  });

  test('uses the current unlocked API source instead of a stale selection', () => {
    assert.equal(sourceForDisplay('api-2024', ['api-2026']), 'api-2026');
  });

  test('falls back to the selection when no source is available', () => {
    assert.equal(sourceForDisplay('api-2026', []), 'api-2026');
  });
});

describe('availableSources', () => {
  test('keeps annual API sources in builder order and drops unsupported entries', () => {
    const meta = document.createElement('meta');
    meta.name = 'bm-sources';
    meta.content = 'api-2026,unsupported,api-2025';
    document.head.appendChild(meta);
    assert.deepEqual(availableSources(), ['api-2026', 'api-2025']);
  });
});

describe('yearForSource', () => {
  test('fails closed when builder current-year metadata is missing', () => {
    assert.throws(
      () => yearForSource('invalid'),
      /bm-brc-map-year metadata is missing or invalid/,
    );
  });

  test('fails closed when builder current-year metadata is malformed', () => {
    const meta = document.createElement('meta');
    meta.name = 'bm-brc-map-year';
    meta.content = 'current';
    document.head.appendChild(meta);
    assert.throws(
      () => yearForSource('invalid'),
      /bm-brc-map-year metadata is missing or invalid/,
    );
  });

  test('reads the builder-provided current BRC year for invalid sources', () => {
    const meta = document.createElement('meta');
    meta.name = 'bm-brc-map-year';
    meta.content = '2027';
    document.head.appendChild(meta);
    assert.equal(yearForSource('invalid'), 2027);
  });

  test('API source identifiers remain independently year-keyed', () => {
    assert.equal(yearForSource('api-2025'), 2025);
  });

  test('current and previous API years resolve only their exact geometry', () => {
    assert.equal(brcForSource('api-2025')?.year, 2025);
    assert.equal(brcForSource('api-2026')?.year, 2026);
  });

  test('a staged future source does not borrow the newest known geometry', () => {
    assert.equal(yearForSource('api-2027'), 2027);
    assert.equal(brcForSource('api-2027'), null);
  });

  test('an unknown source reports unavailable when current geometry is missing', () => {
    const meta = document.createElement('meta');
    meta.name = 'bm-brc-map-year';
    meta.content = '2027';
    document.head.appendChild(meta);
    assert.equal(brcForSource('invalid'), null);
  });
});
