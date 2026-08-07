import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceForDisplay } from '../src/hooks/useSource';

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
