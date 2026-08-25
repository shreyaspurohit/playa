import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScheduleWindows } from '../src/utils/scheduleWindow';

describe('parseScheduleWindows', () => {
  test('reads explicit reviewed windows without deriving dates', () => {
    assert.deepEqual(parseScheduleWindows(JSON.stringify({
      'api-2026': { start: '2026-08-30', end: '2026-09-07' },
      'api-2025': { start: '2025-08-24', end: '2025-09-01' },
    })), {
      'api-2026': { start: '2026-08-30', end: '2026-09-07' },
      'api-2025': { start: '2025-08-24', end: '2025-09-01' },
    });
  });

  test('does not invent a window for an absent source year', () => {
    const windows = parseScheduleWindows(JSON.stringify({
      'api-2026': { start: '2026-08-30', end: '2026-09-07' },
    }));
    assert.equal(windows['api-2025'], undefined);
  });

  test('rejects wrong-year, cross-year, reversed, and malformed entries', () => {
    assert.deepEqual(parseScheduleWindows(JSON.stringify({
      'api-2026': { start: '2026-12-31', end: '2027-01-01' },
      'api-2025': { start: '2025-09-01', end: '2025-08-24' },
      'api-2024': { start: 'not-a-date', end: '2024-09-02' },
      legacy: { start: '2026-08-30', end: '2026-09-07' },
    })), {});
  });

  test('rejects invalid JSON', () => {
    assert.deepEqual(parseScheduleWindows('{'), {});
  });
});
