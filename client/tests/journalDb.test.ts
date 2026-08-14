import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { JournalEntryValue } from '../src/types';
import { activeEntries } from '../src/utils/journalStore';
import {
  clearJournalData, loadDocument, tombstoneEntry, upsertEntry,
} from '../src/utils/journalDb';

function value(text: string): JournalEntryValue {
  return { burnYear: 2026, occurredAt: '2026-08-28T22:30', createdAt: 1000, text };
}

describe('journal IndexedDB layer', () => {
  beforeEach(async () => { await clearJournalData(); });
  afterEach(async () => { await clearJournalData(); });

  test('upsert creates an entry that loadDocument returns', async () => {
    const entry = await upsertEntry(value('first note'), undefined, 1000);
    const doc = await loadDocument();
    assert.equal(Object.keys(doc.entries).length, 1);
    assert.equal(doc.entries[entry.entryId].value?.text, 'first note');
  });

  test('editing overwrites the same entry in place with a newer clock', async () => {
    const first = await upsertEntry(value('v1'), undefined, 1000);
    const second = await upsertEntry(value('v2'), first.entryId, 1000);
    const doc = await loadDocument();
    assert.equal(Object.keys(doc.entries).length, 1);
    assert.equal(doc.entries[first.entryId].value?.text, 'v2');
    assert.ok(second.modifiedAt > first.modifiedAt); // Lamport bump even at equal `now`
  });

  test('tombstone hides the entry from active list', async () => {
    const entry = await upsertEntry(value('doomed'), undefined, 1000);
    await tombstoneEntry(entry.entryId, 2000);
    const doc = await loadDocument();
    assert.equal(doc.entries[entry.entryId].deleted, 1);
    assert.equal(activeEntries(doc).length, 0);
  });

  test('clearJournalData empties everything', async () => {
    await upsertEntry(value('gone'), undefined, 1000);
    await clearJournalData();
    assert.equal(Object.keys((await loadDocument()).entries).length, 0);
  });
});
