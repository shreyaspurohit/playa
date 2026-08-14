import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { JOURNAL_QUOTES, quoteForDay } from '../src/utils/journalQuotes';

const DAY = 86_400_000;

describe('journal quotes', () => {
  test('every quote is non-empty and credited', () => {
    for (const q of JOURNAL_QUOTES) {
      assert.ok(q.text.trim().length > 0, 'text present');
      assert.ok(q.by.trim().length > 0, 'attribution present');
    }
  });

  test('is stable within a day and advances the next day', () => {
    const morning = quoteForDay(10 * DAY + 1_000);
    const evening = quoteForDay(10 * DAY + 80_000_000);
    assert.deepEqual(morning, evening);                    // same day → same quote
    assert.notDeepEqual(quoteForDay(10 * DAY), quoteForDay(11 * DAY)); // next day → moves on
  });

  test('cycles through the whole set and never falls off the end', () => {
    const seen = new Set<string>();
    for (let d = 0; d < JOURNAL_QUOTES.length; d += 1) {
      const q = quoteForDay(d * DAY);
      assert.ok(q, 'always returns a quote');
      seen.add(q.text);
    }
    assert.equal(seen.size, JOURNAL_QUOTES.length);        // consecutive days are all distinct
  });
});
