// Journal cloud cycle (ADR 20 D10/D11) — one optimistic read/merge/write/apply
// against the fixed `/playa-journal.json` App-folder file, plus offline
// export/import. Reuses the allowlisted Dropbox transport; the local source of
// truth is the `playa-journal` IndexedDB. Deletion exists only as a tombstone,
// so an empty local store (eviction, clear, fresh device) is *restored* from
// the cloud and never uploaded as a mass deletion.

import { commitMergedEntries, loadDocument } from '../utils/journalDb';
import {
  documentsEqual, emptyJournalDocument, mergeDocuments, parseJournalDocument,
  serializeJournalDocument,
} from '../utils/journalStore';
import { JOURNAL_PATH } from './dropboxBackend';
import { SyncConflictError, type SyncBackend } from './SyncBackend';

export interface JournalSyncOutcome {
  restoredFromCloud: boolean;
  localChanged: boolean;
}

export const INVALID_JOURNAL_FILE =
  'The Dropbox journal file is not valid. Local entries were not changed.';

// Bounds the read/merge/write/apply loop. Each retry is either a 409 conflict
// (Dropbox moved under us) or `localAhead` (a local edit landed mid-flight and
// needs a second push). A handful of attempts is ample; beyond that we return
// with the local store safe rather than fail — the next trigger will finish.
const MAX_ATTEMPTS = 5;

/**
 * One read/merge/write/apply cycle against `/playa-journal.json`.
 *
 * `local` is re-read at the start of every attempt and the apply step reconciles
 * against the live store (commitMergedEntries), so an entry saved or edited
 * while the Dropbox request was in flight survives, wins when newer, and gets
 * pushed on the follow-up attempt (ADR 20 D10).
 */
export async function syncJournalOnce(backend: SyncBackend): Promise<JournalSyncOutcome> {
  let restoredFromCloud = false;
  let localChanged = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const local = await loadDocument();
    const remoteFile = await backend.readFile(JOURNAL_PATH);
    const remote = remoteFile.text === null ? emptyJournalDocument() : parseJournalDocument(remoteFile.text);
    if (!remote) throw new Error(INVALID_JOURNAL_FILE);
    const merged = mergeDocuments(local, remote);
    if (remoteFile.text === null || !documentsEqual(merged, remote)) {
      try {
        await backend.writeFile(serializeJournalDocument(merged), remoteFile.revision, JOURNAL_PATH);
      } catch (error) {
        if (error instanceof SyncConflictError && attempt < MAX_ATTEMPTS - 1) continue;
        throw error;
      }
    }
    const { changed, localAhead } = await commitMergedEntries(merged);
    localChanged = localChanged || changed;
    if (remoteFile.text !== null && changed) restoredFromCloud = true;
    // A local edit landed during this cycle; loop once more to upload it.
    if (localAhead && attempt < MAX_ATTEMPTS - 1) continue;
    return { restoredFromCloud, localChanged };
  }
  return { restoredFromCloud, localChanged };
}

/** Complete JournalDocument JSON — the only importable recovery format (D15). */
export async function exportJournalJson(): Promise<string> {
  return serializeJournalDocument(await loadDocument());
}

export interface JournalImportResult {
  ok: boolean;
  addedOrChanged: number;
}

/** Merge a previously exported recovery file through the same validation and
 *  LWW merge as a cloud pull — never a blind overwrite (D15). */
export async function importJournalJson(text: string): Promise<JournalImportResult> {
  const incoming = parseJournalDocument(text);
  if (!incoming) return { ok: false, addedOrChanged: 0 };
  const local = await loadDocument();
  const merged = mergeDocuments(local, incoming);
  const { changed } = await commitMergedEntries(merged);
  return { ok: true, addedOrChanged: changed ? Object.keys(merged.entries).length - Object.keys(local.entries).length : 0 };
}
