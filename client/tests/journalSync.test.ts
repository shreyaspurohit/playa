import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { JournalDocument, JournalEntry } from '../src/types';
import { SyncConflictError, type RemoteSyncFile, type SyncBackend } from '../src/sync/SyncBackend';
import { JOURNAL_PATH } from '../src/sync/dropboxBackend';
import {
  exportJournalJson, importJournalJson, syncJournalOnce, INVALID_JOURNAL_FILE,
} from '../src/sync/journalSync';
import { clearJournalData, loadDocument, upsertEntry } from '../src/utils/journalDb';
import { emptyJournalDocument, serializeJournalDocument } from '../src/utils/journalStore';

const UUID_R = '00000000-0000-4000-8000-0000000000r1'.replace('r1', 'f1');
const TOKEN = '00000000-0000-4000-8000-0000000000cc';

function remoteEntry(id: string, text: string, opts: Partial<JournalEntry> = {}): JournalEntry {
  return {
    entryId: id, modifiedAt: 5000, writeToken: TOKEN,
    value: { burnYear: 2026, occurredAt: '2026-08-29T10:00', createdAt: 1, text }, ...opts,
  };
}

function remoteDoc(...entries: JournalEntry[]): string {
  const doc = emptyJournalDocument();
  for (const e of entries) doc.entries[e.entryId] = e;
  return serializeJournalDocument(doc);
}

class FakeBackend implements SyncBackend {
  files = new Map<string, { text: string; rev: string }>();
  // Injected mid-flight (after a network read) to simulate a local edit landing
  // while a sync cycle is in progress.
  onAfterRead?: () => Promise<void>;
  seed(path: string, text: string) { this.files.set(path, { text, rev: 'r0' }); }
  async isConnected() { return true; }
  async authorize() {}
  async beginRedirectAuth() {}
  async completeRedirectAuth() { return false; }
  async disconnect() {}
  async readFile(path = '/playa-sync.json'): Promise<RemoteSyncFile> {
    const f = this.files.get(path);
    const result: RemoteSyncFile = f ? { text: f.text, revision: f.rev } : { text: null, revision: null };
    if (this.onAfterRead) await this.onAfterRead();
    return result;
  }
  async writeFile(text: string, revision: string | null, path = '/playa-sync.json'): Promise<string> {
    const cur = this.files.get(path);
    if ((cur?.rev ?? null) !== revision) throw new SyncConflictError();
    const rev = `r${(this.files.size + 1)}-${Math.random().toString(16).slice(2)}`;
    this.files.set(path, { text, rev });
    return rev;
  }
}

describe('journal sync', () => {
  beforeEach(async () => { await clearJournalData(); });
  afterEach(async () => { await clearJournalData(); });

  test('first sync uploads local entries to an empty cloud', async () => {
    const entry = await upsertEntry({ burnYear: 2026, occurredAt: '2026-08-28T22:30', createdAt: 1, text: 'mine' }, undefined, 1000);
    const backend = new FakeBackend();
    const outcome = await syncJournalOnce(backend);
    assert.equal(outcome.localChanged, false);           // nothing new came down
    const uploaded = JSON.parse(backend.files.get(JOURNAL_PATH)!.text) as JournalDocument;
    assert.equal(uploaded.entries[entry.entryId].value?.text, 'mine');
  });

  test('a remote entry from another device merges into local', async () => {
    const backend = new FakeBackend();
    backend.seed(JOURNAL_PATH, remoteDoc(remoteEntry(UUID_R, 'from phone')));
    const outcome = await syncJournalOnce(backend);
    assert.equal(outcome.localChanged, true);
    assert.equal(outcome.restoredFromCloud, true);
    const local = await loadDocument();
    assert.equal(local.entries[UUID_R].value?.text, 'from phone');
  });

  test('a remote tombstone wins over a local upsert', async () => {
    const entry = await upsertEntry({ burnYear: 2026, occurredAt: '2026-08-28T22:30', createdAt: 1, text: 'keep?' }, undefined, 1000);
    const backend = new FakeBackend();
    backend.seed(JOURNAL_PATH, remoteDoc({ entryId: entry.entryId, modifiedAt: 3000, writeToken: TOKEN, deleted: 1 }));
    await syncJournalOnce(backend);
    const local = await loadDocument();
    assert.equal(local.entries[entry.entryId].deleted, 1);
  });

  test('empty local + populated remote restores and never wipes the cloud', async () => {
    const backend = new FakeBackend();
    const seeded = remoteDoc(remoteEntry(UUID_R, 'survivor'));
    backend.seed(JOURNAL_PATH, seeded);
    // Local is empty (evicted / fresh device).
    await syncJournalOnce(backend);
    const local = await loadDocument();
    assert.equal(local.entries[UUID_R].value?.text, 'survivor');   // restored
    const cloud = JSON.parse(backend.files.get(JOURNAL_PATH)!.text) as JournalDocument;
    assert.ok(cloud.entries[UUID_R]);                              // cloud intact, not wiped
  });

  test('an edit made while the upload is in flight is not clobbered (D10)', async () => {
    // Local starts older than the cloud copy, so a naive sync would pull the
    // cloud text down and overwrite the store.
    const entry = await upsertEntry(
      { burnYear: 2026, occurredAt: '2026-08-28T22:30', createdAt: 1, text: 'local-old' }, undefined, 1000);
    const backend = new FakeBackend();
    backend.seed(JOURNAL_PATH, remoteDoc(remoteEntry(entry.entryId, 'from-cloud', { modifiedAt: 5000 })));
    // While the first cycle is in flight, the user saves a newer edit.
    let injected = false;
    backend.onAfterRead = async () => {
      if (injected) return;
      injected = true;
      await upsertEntry(
        { burnYear: 2026, occurredAt: '2026-08-28T22:30', createdAt: 1, text: 'local-new' }, entry.entryId, 9000);
    };
    await syncJournalOnce(backend);
    const local = await loadDocument();
    assert.equal(local.entries[entry.entryId].value?.text, 'local-new');   // survived, not clobbered
    const cloud = JSON.parse(backend.files.get(JOURNAL_PATH)!.text) as JournalDocument;
    assert.equal(cloud.entries[entry.entryId].value?.text, 'local-new');   // and pushed on the follow-up pass
  });

  test('an invalid remote file aborts without changing local', async () => {
    await upsertEntry({ burnYear: 2026, occurredAt: '2026-08-28T22:30', createdAt: 1, text: 'safe' }, undefined, 1000);
    const backend = new FakeBackend();
    backend.seed(JOURNAL_PATH, '{"schema":"wrong"}');
    await assert.rejects(syncJournalOnce(backend), new RegExp(INVALID_JOURNAL_FILE.slice(0, 20)));
    assert.equal((await loadDocument()).entries && Object.values((await loadDocument()).entries)[0].value?.text, 'safe');
  });

  test('export then import round-trips through validation and merge', async () => {
    await upsertEntry({ burnYear: 2026, occurredAt: '2026-08-28T22:30', createdAt: 1, text: 'exported' }, undefined, 1000);
    const json = await exportJournalJson();
    await clearJournalData();
    const result = await importJournalJson(json);
    assert.equal(result.ok, true);
    assert.equal(Object.values((await loadDocument()).entries)[0].value?.text, 'exported');
  });

  test('import rejects a malformed file', async () => {
    const result = await importJournalJson('not json');
    assert.equal(result.ok, false);
  });
});
