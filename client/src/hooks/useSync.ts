import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Source } from '../types';
import { isSyncedStorageKey } from '../utils/syncDoc';
import { LOCAL_STORAGE_CHANGE_EVENT } from '../utils/storage';
import { DropboxBackend } from '../sync/dropboxBackend';
import { readSyncConfig } from '../sync/config';
import { SyncAuthExpiredError, SyncPopupBlockedError } from '../sync/SyncBackend';
import { syncOnce } from '../sync/syncEngine';
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
  const runningRef = useRef<Promise<void> | null>(null);
  const debounceRef = useRef(0);
  const sourceKey = sources.join(',');

  const run = useCallback(async (reload = true) => {
    if (!backend) return;
    if (runningRef.current) return runningRef.current;
    const task = (async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setStatus('offline');
        setMessage('Offline. Your local changes are safe and will sync when you reconnect.');
        return;
      }
      setStatus('syncing');
      setMessage('');
      try {
        const outcome = await syncOnce(backend, localStorage, sources);
        connectedRef.current = true;
        setStatus('synced');
        setLastSyncedAt(Date.now());
        setMessage(outcome.restoredFromCloud ? 'Dropbox backup restored and merged.' : 'Dropbox is up to date.');
        if (outcome.localChanged && reload) location.reload();
      } catch (error) {
        if (error instanceof SyncAuthExpiredError) {
          connectedRef.current = false;
          setStatus('expired');
          setMessage(error.message);
        } else {
          setStatus('error');
          setMessage(error instanceof Error ? error.message : 'Dropbox sync failed.');
        }
      }
    })().finally(() => { runningRef.current = null; });
    runningRef.current = task;
    return task;
  }, [backend, sourceKey]);

  const connect = useCallback(async () => {
    if (!backend) return;
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
        await backend.authorize();
      } catch (error) {
        // A blocked popup is not a dead end — fall back to the redirect path.
        if (error instanceof SyncPopupBlockedError) {
          setMessage('Redirecting to Dropbox…');
          await backend.beginRedirectAuth();
          return;
        }
        throw error;
      }
      connectedRef.current = true;
      await run();
    } catch (error) {
      connectedRef.current = false;
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Dropbox sign-in failed.');
    }
  }, [backend, run]);

  const disconnect = useCallback(async () => {
    if (!backend) return;
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
    syncNow: run,
    disconnect,
  };
}
