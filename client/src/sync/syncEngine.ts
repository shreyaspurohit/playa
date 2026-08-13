import type { Source } from '../types';
import {
  applySyncDoc,
  emptySyncDoc,
  getOrCreateDeviceId,
  loadSyncBaseline,
  localToSyncDoc,
  migrateMeetSpotRegisters,
  mergeSyncDocs,
  parseSyncDoc,
  saveSyncBaseline,
  syncDocsEqual,
  sourcesInSyncDoc,
} from '../utils/syncDoc';
import { SyncConflictError, type SyncBackend } from './SyncBackend';

interface SyncStorage extends Storage {}

export interface SyncOutcome {
  localChanged: boolean;
  restoredFromCloud: boolean;
}

/** One optimistic read/merge/write/apply cycle. Conflicts re-read and retry. */
export async function syncOnce(
  backend: SyncBackend,
  storage: SyncStorage,
  availableSources: readonly Source[],
  clock: () => number = Date.now,
): Promise<SyncOutcome> {
  const baseline = loadSyncBaseline(storage);
  const deviceId = getOrCreateDeviceId(storage);
  for (let attempt = 0; attempt < 3; attempt++) {
    const remoteFile = await backend.readFile();
    const remote = remoteFile.text === null
      ? emptySyncDoc(deviceId, 0)
      : parseSyncDoc(remoteFile.text);
    if (!remote) throw new Error('The Dropbox backup is not a valid Playa Camps sync file. Local data was not changed.');
    migrateMeetSpotRegisters(remote);
    const sources = [...new Set([
      ...availableSources,
      ...sourcesInSyncDoc(remote),
      ...(baseline ? sourcesInSyncDoc(baseline) : []),
    ])];
    const at = clock();
    const local = localToSyncDoc(storage, sources, baseline, deviceId, at);
    const merged = mergeSyncDocs(local, remote, at);
    if (remoteFile.text === null || !syncDocsEqual(merged, remote)) {
      try {
        await backend.writeFile(JSON.stringify(merged), remoteFile.revision);
      } catch (error) {
        if (error instanceof SyncConflictError && attempt < 2) continue;
        throw error;
      }
    }
    // Save the baseline before applying/reloading. If the browser kills the
    // page during reload, the merged timestamps still match local state.
    saveSyncBaseline(storage, merged);
    // Root metadata (updatedAt/deviceId) is merge bookkeeping, not a remote
    // change. Compare the logical operations before applying so a favorite
    // made on this device does not look like a restore and reload the whole
    // page. A reload is only needed when the merged document adds/removes a
    // logical value from Dropbox (for example, a star from another device).
    const comparableLocal = {
      ...local,
      deviceId: merged.deviceId,
      updatedAt: merged.updatedAt,
    };
    const remoteChanged = !syncDocsEqual(comparableLocal, merged);
    const localChanged = applySyncDoc(storage, merged);
    return {
      localChanged: remoteChanged && localChanged,
      restoredFromCloud: remoteFile.text !== null && baseline === null,
    };
  }
  throw new Error('Dropbox changed repeatedly while syncing. Try again.');
}
