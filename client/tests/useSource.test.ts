import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, teardownDom } from './_dom';
import { brcForSource, sourceForDisplay, yearForSource } from '../src/hooks/useSource';

beforeEach(() => { installDom(); });
afterEach(() => { teardownDom(); });

describe('sourceForDisplay', () => {
  test('keeps a selected source that is available', () => {
    assert.equal(
      sourceForDisplay('api-2025', ['api-2025', 'api-2026']),
      'api-2025',
    );
  });

  test('uses the unlocked API source instead of a stale directory selection', () => {
    assert.equal(sourceForDisplay('directory', ['api-2026']), 'api-2026');
  });

  test('falls back to the selection when no source is available', () => {
    assert.equal(sourceForDisplay('directory', []), 'directory');
  });
});

describe('yearForSource', () => {
  test('reads the builder-provided directory map year', () => {
    const meta = document.createElement('meta');
    meta.name = 'bm-directory-map-year';
    meta.content = '2027';
    document.head.appendChild(meta);
    assert.equal(yearForSource('directory'), 2027);
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

  test('directory also reports unavailable when its configured year is missing', () => {
    const meta = document.createElement('meta');
    meta.name = 'bm-directory-map-year';
    meta.content = '2027';
    document.head.appendChild(meta);
    assert.equal(brcForSource('directory'), null);
  });
});
