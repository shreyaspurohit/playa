// Offline journal persistence — the `playa-journal` IndexedDB (ADR 20 D1).
//
// One object store: `entries` (the current value or a tombstone per entry). Pure
// model/merge logic lives in journalStore.ts; this file is only I/O. Saves
// commit here before the UI reports success (D1). No drafts, no persisted
// pending-deletes — the editor and undo are kept in-memory for simplicity.

import type { JournalDocument, JournalEntry, JournalEntryValue } from '../types';
import {
  emptyJournalDocument, greatestModifiedAt, newEntryId, newWriteToken, nextModifiedAt, pickEntry,
} from './journalStore';

export const JOURNAL_DB = 'playa-journal';
// v2 keeps the version monotonic for testers who already created it; only the
// `entries` store is used now.
const DB_VERSION = 2;
const ENTRIES = 'entries';

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('journal transaction aborted'));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
let liveDb: IDBDatabase | null = null;

export function openJournalDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('This browser has no IndexedDB; journaling is unavailable here.'));
  }
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(JOURNAL_DB, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES, { keyPath: 'entryId' });
    };
    open.onsuccess = () => { liveDb = open.result; resolve(open.result); };
    open.onerror = () => reject(open.error);
  });
  return dbPromise;
}

/** Close and drop the cached handle so a subsequent deleteDatabase can proceed
 *  (an open connection blocks deletion). */
export function _resetJournalDbHandle(): void {
  try { liveDb?.close(); } catch { /* ignore */ }
  liveDb = null;
  dbPromise = null;
}

async function readAllEntries(): Promise<JournalEntry[]> {
  const db = await openJournalDb();
  const tx = db.transaction(ENTRIES, 'readonly');
  return promisify(tx.objectStore(ENTRIES).getAll() as IDBRequest<JournalEntry[]>);
}

/** All entries as a document. */
export async function loadDocument(): Promise<JournalDocument> {
  const doc = emptyJournalDocument();
  for (const entry of await readAllEntries()) doc.entries[entry.entryId] = entry;
  return doc;
}

/** Write entries as-is (a fresh local upsert/tombstone is authoritative for its
 *  own id). Sync uses commitMergedEntries instead, which reconciles. */
export async function putEntries(entries: JournalEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const db = await openJournalDb();
  const tx = db.transaction(ENTRIES, 'readwrite');
  const store = tx.objectStore(ENTRIES);
  for (const entry of entries) store.put(entry);
  await txDone(tx);
}

function sameEntry(a: JournalEntry, b: JournalEntry): boolean {
  return a.modifiedAt === b.modifiedAt && a.writeToken === b.writeToken
    && (a.deleted === 1) === (b.deleted === 1);
}

export interface CommitResult {
  changed: boolean;    // the local store was modified
  localAhead: boolean; // the store holds data newer than `merged` (a mid-flight
                       // edit) — the cloud copy we just uploaded is now behind
}

/**
 * Apply a synced document into the *current* store atomically (ADR 20 D10).
 *
 * The critical difference from putEntries: we read the live store inside the
 * same readwrite transaction and pick the LWW winner per id, so an entry saved
 * or edited while the Dropbox request was in flight is never overwritten by the
 * older snapshot the sync started from. `localAhead` tells the caller the store
 * moved past what was uploaded, so it can schedule one more push.
 */
export async function commitMergedEntries(merged: JournalDocument): Promise<CommitResult> {
  const db = await openJournalDb();
  const tx = db.transaction(ENTRIES, 'readwrite');
  const store = tx.objectStore(ENTRIES);
  const current = await promisify(store.getAll() as IDBRequest<JournalEntry[]>);
  const currentById = new Map<string, JournalEntry>();
  for (const e of current) currentById.set(e.entryId, e);

  let changed = false;
  let localAhead = false;
  const mergedIds = new Set<string>();
  for (const incoming of Object.values(merged.entries)) {
    mergedIds.add(incoming.entryId);
    const existing = currentById.get(incoming.entryId);
    const winner = pickEntry(incoming, existing)!;
    if (!existing || !sameEntry(winner, existing)) { store.put(winner); changed = true; }
    // The live entry beat what we uploaded → cloud is behind for this id.
    if (existing && !sameEntry(winner, incoming)) localAhead = true;
  }
  // A brand-new entry created mid-flight isn't in `merged` at all.
  for (const e of current) if (!mergedIds.has(e.entryId)) localAhead = true;

  await txDone(tx);
  return { changed, localAhead };
}

async function currentMaxModifiedAt(): Promise<number> {
  return greatestModifiedAt(await readAllEntries());
}

/** Create a new entry or overwrite an existing one in place (D2). */
export async function upsertEntry(
  value: JournalEntryValue, entryId?: string, now = Date.now(),
): Promise<JournalEntry> {
  const entry: JournalEntry = {
    entryId: entryId ?? newEntryId(),
    modifiedAt: nextModifiedAt(await currentMaxModifiedAt(), now),
    writeToken: newWriteToken(),
    value,
  };
  await putEntries([entry]);
  return entry;
}

/** Write a permanent tombstone for an entry (D10). */
export async function tombstoneEntry(entryId: string, now = Date.now()): Promise<JournalEntry> {
  const entry: JournalEntry = {
    entryId,
    modifiedAt: nextModifiedAt(await currentMaxModifiedAt(), now),
    writeToken: newWriteToken(),
    deleted: 1,
  };
  await putEntries([entry]);
  return entry;
}

/** Delete the whole journal database (Clear all local data — D12). */
export function clearJournalData(): Promise<void> {
  _resetJournalDbHandle();
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(JOURNAL_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();      // best-effort, matches other clear paths
    request.onblocked = () => resolve();
  });
}
