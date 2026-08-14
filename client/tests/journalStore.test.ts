import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { JournalDocument, JournalEntry, JournalEntryValue } from '../src/types';
import {
  JOURNAL_SCHEMA,
  activeEntries,
  cleanEntryValue,
  emptyJournalDocument,
  mergeDocuments,
  newEntryId,
  newWriteToken,
  nextModifiedAt,
  parseJournalDocument,
  pickEntry,
  serializeJournalDocument,
  timeOfDayBucket,
  validOccurredAt,
} from '../src/utils/journalStore';

const UUID_A = '00000000-0000-4000-8000-000000000001';
const UUID_B = '00000000-0000-4000-8000-000000000002';
const TOKEN_LO = '00000000-0000-4000-8000-0000000000aa';
const TOKEN_HI = '00000000-0000-4000-8000-0000000000bb';

function value(text: string, over: Partial<JournalEntryValue> = {}): JournalEntryValue {
  return { burnYear: 2026, occurredAt: '2026-08-28T22:30', createdAt: 1000, text, ...over };
}

function upsert(id: string, modifiedAt: number, text: string, writeToken = TOKEN_LO): JournalEntry {
  return { entryId: id, modifiedAt, writeToken, value: value(text) };
}

function tombstone(id: string, modifiedAt: number, writeToken = TOKEN_LO): JournalEntry {
  return { entryId: id, modifiedAt, writeToken, deleted: 1 };
}

function doc(...entries: JournalEntry[]): JournalDocument {
  const out = emptyJournalDocument();
  for (const e of entries) out.entries[e.entryId] = e;
  return out;
}

describe('journal merge (per-entry LWW)', () => {
  test('newer edit overwrites older; the older text is not retained', () => {
    const merged = mergeDocuments(doc(upsert(UUID_A, 10, 'old')), doc(upsert(UUID_A, 20, 'new')));
    assert.equal(Object.keys(merged.entries).length, 1);
    assert.equal(merged.entries[UUID_A].value?.text, 'new');
  });

  test('equal modifiedAt resolves deterministically by writeToken', () => {
    const a = doc(upsert(UUID_A, 10, 'lo', TOKEN_LO));
    const b = doc(upsert(UUID_A, 10, 'hi', TOKEN_HI));
    assert.equal(mergeDocuments(a, b).entries[UUID_A].value?.text, 'hi');
    assert.equal(mergeDocuments(b, a).entries[UUID_A].value?.text, 'hi');
  });

  test('a tombstone wins permanently, even over a newer upsert', () => {
    // delete at t=10 vs edit at t=20 (a stale device that never saw the delete)
    assert.equal(pickEntry(tombstone(UUID_A, 10), upsert(UUID_A, 20, 'resurrect'))?.deleted, 1);
    assert.equal(pickEntry(upsert(UUID_A, 20, 'resurrect'), tombstone(UUID_A, 10))?.deleted, 1);
    const merged = mergeDocuments(doc(upsert(UUID_A, 20, 'resurrect')), doc(tombstone(UUID_A, 10)));
    assert.equal(merged.entries[UUID_A].deleted, 1);
    assert.equal(activeEntries(merged).length, 0);
  });

  test('entries present on only one side pass through', () => {
    const merged = mergeDocuments(doc(upsert(UUID_A, 10, 'a')), doc(upsert(UUID_B, 10, 'b')));
    assert.deepEqual(Object.keys(merged.entries).sort(), [UUID_A, UUID_B]);
  });

  test('merge is order-independent and idempotent', () => {
    const a = doc(upsert(UUID_A, 30, 'a3', TOKEN_HI), tombstone(UUID_B, 5));
    const b = doc(upsert(UUID_A, 10, 'a1'), upsert(UUID_B, 40, 'b-live'));
    const ab = serializeJournalDocument(mergeDocuments(a, b));
    const ba = serializeJournalDocument(mergeDocuments(b, a));
    assert.equal(ab, ba);
    // idempotent: merging the result with either input changes nothing
    assert.equal(serializeJournalDocument(mergeDocuments(mergeDocuments(a, b), b)), ab);
    // B was deleted on side a (t=5) but edited on side b (t=40); tombstone wins
    assert.equal(mergeDocuments(a, b).entries[UUID_B].deleted, 1);
  });

  test('nextModifiedAt advances past a fast observed clock', () => {
    assert.equal(nextModifiedAt(500, 100), 501);
    assert.equal(nextModifiedAt(100, 900), 900);
  });
});

describe('journal validation (D13)', () => {
  function validDoc(): string {
    const d = doc(
      { entryId: UUID_A, modifiedAt: 10, writeToken: TOKEN_LO, value: value('hi', { context: { kind: 'camp', title: 'Camp X' } }) },
      tombstone(UUID_B, 20, TOKEN_HI),
    );
    return serializeJournalDocument(d);
  }

  test('a well-formed document round-trips', () => {
    const parsed = parseJournalDocument(validDoc());
    assert.ok(parsed);
    assert.equal(parsed!.entries[UUID_A].value?.text, 'hi');
    assert.equal(parsed!.entries[UUID_B].deleted, 1);
  });

  test('wrong schema is rejected', () => {
    assert.equal(parseJournalDocument(JSON.stringify({ schema: 'nope', entries: {} })), null);
  });

  test('a map key that does not match entryId is rejected', () => {
    const bad = JSON.stringify({ schema: JOURNAL_SCHEMA, entries: { [UUID_A]: { entryId: UUID_B, modifiedAt: 1, writeToken: TOKEN_LO, value: value('x') } } });
    assert.equal(parseJournalDocument(bad), null);
  });

  test('a tombstone carrying a value, or an upsert missing one, is rejected', () => {
    const withValue = JSON.stringify({ schema: JOURNAL_SCHEMA, entries: { [UUID_A]: { entryId: UUID_A, modifiedAt: 1, writeToken: TOKEN_LO, deleted: 1, value: value('x') } } });
    const noValue = JSON.stringify({ schema: JOURNAL_SCHEMA, entries: { [UUID_A]: { entryId: UUID_A, modifiedAt: 1, writeToken: TOKEN_LO } } });
    assert.equal(parseJournalDocument(withValue), null);
    assert.equal(parseJournalDocument(noValue), null);
  });

  test('non-UUID ids and writeTokens are rejected', () => {
    const badId = JSON.stringify({ schema: JOURNAL_SCHEMA, entries: { 'not-a-uuid': { entryId: 'not-a-uuid', modifiedAt: 1, writeToken: TOKEN_LO, value: value('x') } } });
    assert.equal(parseJournalDocument(badId), null);
  });
});

describe('journal value validation (D3)', () => {
  test('newlines and tabs are preserved in text', () => {
    const v = cleanEntryValue(value('line1\nline2\twith tab'));
    assert.equal(v?.text, 'line1\nline2\twith tab');
  });

  test('empty/whitespace text is rejected', () => {
    assert.equal(cleanEntryValue(value('   \n  ')), null);
  });

  test('a control character in text is rejected', () => {
    assert.equal(cleanEntryValue(value(`bad${String.fromCharCode(7)}bell`)), null);
  });

  test('oversized text is rejected', () => {
    assert.equal(cleanEntryValue(value('x'.repeat(20 * 1024 + 1))), null);
  });

  test('burnYear out of range is rejected', () => {
    assert.equal(cleanEntryValue(value('hi', { burnYear: 1999 })), null);
    assert.equal(cleanEntryValue(value('hi', { burnYear: 2101 })), null);
  });

  test('an implausibly large timestamp is rejected (D13)', () => {
    const huge = Date.UTC(2100, 0, 1) + 1;   // one ms past the plausible ceiling
    // createdAt in a value…
    assert.equal(cleanEntryValue(value('hi', { createdAt: huge })), null);
    // …and modifiedAt on a whole entry (poisoned merge clock).
    const bad = JSON.stringify({
      schema: JOURNAL_SCHEMA,
      entries: { [UUID_A]: { entryId: UUID_A, modifiedAt: huge, writeToken: TOKEN_LO, value: value('x') } },
    });
    assert.equal(parseJournalDocument(bad), null);
  });

  test('occurredAt must be a real calendar minute', () => {
    assert.ok(validOccurredAt('2026-08-28T22:30'));
    assert.equal(validOccurredAt('2026-02-30T00:00'), false); // Feb 30
    assert.equal(validOccurredAt('2026-08-28T24:00'), false); // hour 24
    assert.equal(validOccurredAt('2026-8-28T22:30'), false);  // not zero-padded
    assert.equal(validOccurredAt('2026-08-28 22:30'), false); // space not T
  });

  test('an optional title is trimmed, kept, or dropped when blank', () => {
    assert.equal(cleanEntryValue(value('hi', { title: '  My day  ' }))?.title, 'My day');
    assert.equal(cleanEntryValue(value('hi', { title: '   ' }))?.title, undefined); // blank → absent
    assert.equal(cleanEntryValue(value('hi', { title: 'x'.repeat(201) })), null);   // too long
    assert.equal(cleanEntryValue(value('hi', { title: `bad${String.fromCharCode(10)}line` })), null); // newline in title
  });

  test('context kind must be known and fields bounded', () => {
    assert.equal(cleanEntryValue(value('hi', { context: { kind: 'bogus' as never, title: 'X' } })), null);
    assert.equal(cleanEntryValue(value('hi', { context: { kind: 'camp', title: 'x'.repeat(301) } })), null);
    const ok = cleanEntryValue(value('hi', { context: { kind: 'event', title: 'Sound Camp', campName: 'Host' } }));
    assert.deepEqual(ok?.context, { kind: 'event', title: 'Sound Camp', campName: 'Host' });
  });
});

describe('journal delight layer (D18)', () => {
  test('timeOfDayBucket maps hours correctly, night wraps midnight', () => {
    assert.equal(timeOfDayBucket(6), 'dawn');
    assert.equal(timeOfDayBucket(10), 'morning');
    assert.equal(timeOfDayBucket(14), 'afternoon');
    assert.equal(timeOfDayBucket(18), 'dusk');
    assert.equal(timeOfDayBucket(22), 'night');
    assert.equal(timeOfDayBucket(2), 'night');
  });

  test('mood must be a known allowlist key', () => {
    assert.equal(cleanEntryValue(value('hi', { mood: 'grateful' }))?.mood, 'grateful');
    assert.equal(cleanEntryValue(value('hi', { mood: 'not-a-mood' })), null);
  });
});

describe('journal id helpers', () => {
  test('generated ids and tokens are UUIDs', () => {
    assert.match(newEntryId(), /^[0-9a-f-]{36}$/i);
    assert.match(newWriteToken(), /^[0-9a-f-]{36}$/i);
    assert.notEqual(newEntryId(), newEntryId());
  });
});
