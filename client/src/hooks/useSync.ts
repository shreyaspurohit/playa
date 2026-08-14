import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Source } from '../types';
import { isSyncedStorageKey } from '../utils/syncDoc';
import { LOCAL_STORAGE_CHANGE_EVENT } from '../utils/storage';
import { DropboxBackend } from '../sync/dropboxBackend';
import { readSyncConfig } from '../sync/config';
import {
  SyncAuthExpiredError, SyncAuthorizationCancelledError, SyncPopupBlockedError,
} from '../sync/SyncBackend';
import { syncOnce } from '../sync/syncEngine';
import { syncJournalOnce } from '../sync/journalSync';
import { notifyJournalChanged } from '../utils/journalEntryBus';
import { isStandaloneDisplay } from '../utils/standalone';

export type SyncStatus =
  | 'unavailable' | 'checking' | 'disconnected' | 'connecting' | 'syncing'
  | 'synced' | 'offline' | 'expired' | 'error';

export interface SyncController {
  available: boolean;
  connected: boolean;
  status: SyncStatus;
  message: string;
  lastSyncedAt: number | null;
  connect: () => Promise<void>;
  cancelConnect: () => void;
  syncNow: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export function useSync(sources: readonly Source[]): SyncController {
  const config = useMemo(readSyncConfig, []);
  const backend = useMemo(() => config ? new DropboxBackend(config) : null, [config]);
  const [status, setStatus] = useState<SyncStatus>(config ? 'checking' : 'unavailable');
  const [message, setMessage] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const connectedRef = useRef(false);
  const runningRef = useRef<{ epoch: number; promise: Promise<void> } | null>(null);
  const syncEpochRef = useRef(0);
  const debounceRef = useRef(0);
  const authAbortRef = useRef<AbortController | null>(null);
  const authorizedAttemptRef = useRef<AbortController | null>(null);
  const sourceKey = sources.join(',');

  const run = useCallback(async (reload = true) => {
    if (!backend) return;
    const epoch = syncEpochRef.current;
    while (runningRef.current) {
      const running = runningRef.current;
      // Preserve the normal coalescing behavior for focus/storage/online
      // triggers that arrive during the same sync cycle.
      if (running.epoch === epoch) return running.promise;
      await running.promise;
      // A current attempt queued behind a cancelled/stale run still needs its
      // own sync. A stale caller stops here and cannot revive cancelled UI.
      if (epoch !== syncEpochRef.current) return;
    }
    const task = (async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (epoch !== syncEpochRef.current) return;
        setStatus('offline');
        setMessage('Offline. Your local changes are safe and will sync when you reconnect.');
        return;
      }
      if (epoch !== syncEpochRef.current) return;
      setStatus('syncing');
      setMessage('');
      try {
        const outcome = await syncOnce(backend, localStorage, sources);
        if (epoch !== syncEpochRef.current) return;
        connectedRef.current = true;
        setStatus('synced');
        setLastSyncedAt(Date.now());
        // Sync the journal on the same trigger (its own file, best-effort — a
        // journal failure must never flip the plan-state *status*, D11 — but the
        // message must not claim the journal is backed up when it isn't).
        let journalFailed = false;
        try {
          const journalOutcome = await syncJournalOnce(backend);
          if (journalOutcome.localChanged) notifyJournalChanged();
        } catch { journalFailed = true; }
        if (epoch !== syncEpochRef.current) return;
        setMessage(
          journalFailed
            ? 'Plans synced. Journal backup didn’t finish — it will retry.'
            : outcome.restoredFromCloud ? 'Dropbox backup restored and merged.' : 'Dropbox is up to date.',
        );
        if (outcome.localChanged && reload) location.reload();
      } catch (error) {
        if (epoch !== syncEpochRef.current) return;
        if (error instanceof SyncAuthExpiredError) {
          connectedRef.current = false;
          setStatus('expired');
          setMessage(error.message);
        } else {
          setStatus('error');
          setMessage(error instanceof Error ? error.message : 'Dropbox sync failed.');
        }
      }
    })();
    runningRef.current = { epoch, promise: task };
    try {
      await task;
    } finally {
      if (runningRef.current?.promise === task) runningRef.current = null;
    }
  }, [backend, sourceKey]);

  const connect = useCallback(async () => {
    if (!backend) return;
    authAbortRef.current?.abort();
    const authAbort = new AbortController();
    authAbortRef.current = authAbort;
    setStatus('connecting');
    setMessage('Opening Dropbox…');
    try {
      // Installed/standalone PWAs (notably iOS home-screen) can't receive the
      // popup's code handoff, so authorize via a same-tab full-page redirect;
      // the page unloads here and resumes in completeRedirectAuth on return.
      if (isStandaloneDisplay()) {
        setMessage('Redirecting to Dropbox…');
        await backend.beginRedirectAuth();
        return;
      }
      try {
        await backend.authorize(authAbort.signal);
      } catch (error) {
        // A blocked popup is not a dead end — fall back to the redirect path.
        if (error instanceof SyncPopupBlockedError) {
          setMessage('Redirecting to Dropbox…');
          await backend.beginRedirectAuth();
          return;
        }
        throw error;
      }
      authorizedAttemptRef.current = authAbort;
      connectedRef.current = true;
      await run();
    } catch (error) {
      // An explicitly cancelled attempt may already have been replaced by a
      // retry. Never let the older promise overwrite the newer attempt's UI.
      if (authAbortRef.current !== authAbort) return;
      connectedRef.current = false;
      setStatus(error instanceof SyncAuthorizationCancelledError ? 'disconnected' : 'error');
      setMessage(error instanceof Error ? error.message : 'Dropbox sign-in failed.');
    } finally {
      if (authAbortRef.current === authAbort) {
        authAbortRef.current = null;
        if (authorizedAttemptRef.current === authAbort) authorizedAttemptRef.current = null;
      }
    }
  }, [backend, run]);

  const cancelConnect = useCallback(() => {
    const attempt = authAbortRef.current;
    attempt?.abort();
    authAbortRef.current = null;
    syncEpochRef.current++;
    if (attempt && authorizedAttemptRef.current === attempt) {
      authorizedAttemptRef.current = null;
      // DropboxBackend removes the wrapped local credential synchronously,
      // then revokes remotely on a best-effort basis (including offline).
      void backend?.disconnect();
    }
    connectedRef.current = false;
    setStatus('disconnected');
    setMessage('Dropbox sign-in was cancelled. You can try again.');
  }, [backend]);

  const disconnect = useCallback(async () => {
    if (!backend) return;
    authAbortRef.current?.abort();
    authAbortRef.current = null;
    authorizedAttemptRef.current = null;
    syncEpochRef.current++;
    await backend.disconnect();
    connectedRef.current = false;
    setStatus('disconnected');
    setMessage('Dropbox disconnected. The cloud backup and local plans were kept.');
  }, [backend]);

  useEffect(() => {
    if (!backend) return;
    let cancelled = false;
    (async () => {
      // First, complete a pending redirect authorization if this boot is its
      // callback (standalone-PWA path, ADR 16 D13).
      try {
        const handled = await backend.completeRedirectAuth();
        if (cancelled) return;
        if (handled) {
          connectedRef.current = true;
          void run();
          return;
        }
      } catch (error) {
        if (cancelled) return;
        connectedRef.current = false;
        setStatus(error instanceof SyncAuthExpiredError ? 'expired' : 'error');
        setMessage(error instanceof Error ? error.message : 'Dropbox sign-in failed.');
        return;
      }
      // Otherwise restore a saved session as before.
      const connected = await backend.isConnected();
      if (cancelled) return;
      connectedRef.current = connected;
      setStatus(connected ? 'synced' : 'disconnected');
      if (connected) void run();
    })();
    return () => { cancelled = true; };
  }, [backend, run]);

  useEffect(() => {
    if (!backend) return;
    const schedule = () => {
      if (!connectedRef.current) return;
      window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => void run(), 1500);
    };
    const onLocal = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (key && isSyncedStorageKey(key)) schedule();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key && isSyncedStorageKey(event.key)) schedule();
    };
    const onOnline = () => { if (connectedRef.current) void run(); };
    const onFocus = () => { if (connectedRef.current) void run(); };
    window.addEventListener(LOCAL_STORAGE_CHANGE_EVENT, onLocal);
    window.addEventListener('storage', onStorage);
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearTimeout(debounceRef.current);
      window.removeEventListener(LOCAL_STORAGE_CHANGE_EVENT, onLocal);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onFocus);
    };
  }, [backend, run]);

  return {
    available: !!backend,
    connected: connectedRef.current,
    status,
    message,
    lastSyncedAt,
    connect,
    cancelConnect,
    syncNow: run,
    disconnect,
  };
}
