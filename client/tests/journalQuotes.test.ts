import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { JOURNAL_QUOTES, quoteForDay } from '../src/utils/journalQuotes';

describe('journal quotes', () => {
  test('every quote is non-empty and credited', () => {
    for (const q of JOURNAL_QUOTES) {
      assert.ok(q.text.trim().length > 0, 'text present');
      assert.ok(q.by.trim().length > 0, 'attribution present');
    }
  });

  test('is stable within a day and advances the next day', () => {
    assert.deepEqual(quoteForDay('2026-08-31'), quoteForDay('2026-08-31'));
    assert.notDeepEqual(quoteForDay('2026-08-31'), quoteForDay('2026-09-01'));
  });

  test('cycles through the whole set and never falls off the end', () => {
    const seen = new Set<string>();
    for (let d = 0; d < JOURNAL_QUOTES.length; d += 1) {
      const q = quoteForDay(new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10));
      assert.ok(q, 'always returns a quote');
      seen.add(q.text);
    }
    assert.equal(seen.size, JOURNAL_QUOTES.length);        // consecutive days are all distinct
  });
});
