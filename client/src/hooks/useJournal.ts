// Journal local state + actions (ADR 20). Owns the in-memory view of the
// `playa-journal` IndexedDB, coordinates tabs over a BroadcastChannel, and runs
// opportunistic Dropbox sync when a session exists. Saves commit to IndexedDB
// before the UI updates (D1). Delete has a brief in-memory undo (no persistence).

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JournalDocument, JournalEntry, JournalEntryValue } from '../types';
import { activeEntries } from '../utils/journalStore';
import {
  clearJournalData as clearDb, loadDocument, tombstoneEntry, upsertEntry,
} from '../utils/journalDb';
import { readSyncConfig } from '../sync/config';
import { DropboxBackend } from '../sync/dropboxBackend';
import { SyncPopupBlockedError } from '../sync/SyncBackend';
import { isStandaloneDisplay } from '../utils/standalone';
import { exportJournalJson, importJournalJson, syncJournalOnce } from '../sync/journalSync';

const CHANNEL = 'playa-journal';
export const UNDO_WINDOW_MS = 5000;

export interface JournalDayGroup {
  dayKey: string;               // 'YYYY-MM-DD'
  dayLabel: string;             // 'Thu · Aug 28'
  entries: JournalEntry[];      // newest occurredAt first
}

export interface JournalYearGroup {
  year: number;
  days: JournalDayGroup[];      // newest day first
}

export interface JournalController {
  ready: boolean;
  usable: boolean;              // false when the IndexedDB store failed to open — never imply a save can succeed (D1)
  error: string | null;
  hasBackend: boolean;          // a Dropbox sync provider is configured
  connected: boolean;           // a Dropbox session exists
  connect: () => Promise<void>; // authorize Dropbox, then sync (works while the site is locked — D16)
  groups: JournalYearGroup[];   // active entries grouped by burnYear (desc), filtered by query
  count: number;                // total active entries (unfiltered)
  query: string;
  setQuery: (q: string) => void;
  addEntry: (value: JournalEntryValue) => Promise<JournalEntry>;
  editEntry: (entryId: string, value: JournalEntryValue) => Promise<void>;
  deleteEntry: (entryId: string) => Promise<void>;
  undoDelete: (entryId: string) => Promise<void>;
  pendingDeleteIds: ReadonlySet<string>;
  exportJson: () => Promise<string>;
  importJson: (text: string) => Promise<{ ok: boolean; addedOrChanged: number }>;
  syncNow: () => Promise<void>;
}

function matches(entry: JournalEntry, needle: string): boolean {
  if (!needle) return true;
  const v = entry.value;
  if (!v) return false;
  const hay = `${v.title ?? ''}\n${v.text}\n${v.context?.title ?? ''}\n${v.context?.campName ?? ''}`.toLowerCase();
  return hay.includes(needle);
}

function dayLabelFor(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const month = dt.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${weekday} · ${month} ${d}`;
}

function newestFirst(a: JournalEntry, b: JournalEntry): number {
  const at = b.value!.occurredAt.localeCompare(a.value!.occurredAt);
  return at !== 0 ? at : b.value!.createdAt - a.value!.createdAt;
}

function group(doc: JournalDocument, query: string, hidden: ReadonlySet<string>): JournalYearGroup[] {
  const needle = query.trim().toLowerCase();
  const byYear = new Map<number, JournalEntry[]>();
  for (const entry of activeEntries(doc)) {
    if (hidden.has(entry.entryId) || !matches(entry, needle)) continue;
    const year = entry.value!.burnYear;
    (byYear.get(year) ?? byYear.set(year, []).get(year)!).push(entry);
  }
  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])                       // year desc
    .map(([year, entries]) => {
      const byDay = new Map<string, JournalEntry[]>();
      for (const entry of entries) {
        const dayKey = entry.value!.occurredAt.slice(0, 10);
        (byDay.get(dayKey) ?? byDay.set(dayKey, []).get(dayKey)!).push(entry);
      }
      const days = [...byDay.entries()]
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))         // day desc
        .map(([dayKey, dayEntries]) => ({
          dayKey, dayLabel: dayLabelFor(dayKey), entries: dayEntries.sort(newestFirst),
        }));
      return { year, days };
    });
}

export function useJournal(): JournalController {
  const [doc, setDoc] = useState<JournalDocument>({ schema: 'playa-journal-v1', entries: {} });
  const [ready, setReady] = useState(false);
  const [usable, setUsable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [connected, setConnected] = useState(false);
  const undoTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const backend = useMemo(() => {
    const config = readSyncConfig();
    return config ? new DropboxBackend(config) : null;
  }, []);

  const reload = useCallback(async () => {
    setDoc(await loadDocument());
  }, []);

  const runSync = useCallback(async () => {
    if (!backend) return;
    try {
      const isConnected = await backend.isConnected();
      setConnected(isConnected);
      if (!isConnected) return;
      const outcome = await syncJournalOnce(backend);
      if (outcome.localChanged) await reload();
    } catch { /* journal sync is best-effort; local stays authoritative */ }
  }, [backend, reload]);

  const connect = useCallback(async () => {
    if (!backend) return;
    try {
      // Match useSync's authorization handling: installed/standalone PWAs
      // (notably iOS home-screen) can't receive the popup handoff, so use a
      // same-tab redirect; the page unloads and useSync.completeRedirectAuth
      // resumes the session on return. A blocked popup falls back the same way.
      if (isStandaloneDisplay()) { await backend.beginRedirectAuth(); return; }
      try {
        await backend.authorize();
      } catch (err) {
        if (err instanceof SyncPopupBlockedError) { await backend.beginRedirectAuth(); return; }
        throw err;
      }
      setConnected(true);
      await runSync();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dropbox connection failed.');
    }
  }, [backend, runSync]);

  const bump = useCallback((entryId?: string) => {
    try {
      if ('BroadcastChannel' in window) {
        const ch = new BroadcastChannel(CHANNEL);
        ch.postMessage({ type: 'journal-changed', entryId });
        ch.close();
      }
    } catch { /* ignore */ }
  }, []);

  // Boot: load from IndexedDB, then opportunistically sync. A failed open
  // surfaces a visible error so the UI never implies the journal is available.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
        if (cancelled) return;
        setReady(true);
        void runSync();
      } catch (err) {
        // The store never opened — journaling is not usable in this browser
        // (private mode, no IndexedDB). Surface it and keep Add disabled so the
        // UI never implies a save will persist (D1).
        if (!cancelled) { setError(err instanceof Error ? err.message : 'Journal unavailable.'); setUsable(false); setReady(true); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Multi-tab + focus/online: reload from IndexedDB and sync.
  useEffect(() => {
    const onExternal = () => { void reload(); };
    const onActive = () => { void reload(); void runSync(); };
    let channel: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = onExternal;
    }
    window.addEventListener('focus', onActive);
    window.addEventListener('online', onActive);
    return () => {
      try { channel?.close(); } catch { /* ignore */ }
      window.removeEventListener('focus', onActive);
      window.removeEventListener('online', onActive);
    };
  }, [reload, runSync]);

  function armUndoTimer(entryId: string, delay: number): void {
    const timers = undoTimers.current;
    clearTimeout(timers.get(entryId));
    timers.set(entryId, setTimeout(() => { void commitDelete(entryId); }, delay));
  }

  const commitDelete = useCallback(async (entryId: string) => {
    undoTimers.current.delete(entryId);
    try { await tombstoneEntry(entryId); } catch { /* best-effort */ }
    setPendingIds((prev) => { const next = new Set(prev); next.delete(entryId); return next; });
    await reload();
    bump(entryId);
    void runSync();
  }, [reload, bump, runSync]);

  // Propagates on failure (symmetric with editEntry) so the editor's own
  // try/catch keeps the entry open with its text intact — never silently
  // closes as if saved (D1).
  const addEntry = useCallback(async (value: JournalEntryValue) => {
    const entry = await upsertEntry(value);
    await reload();
    bump(entry.entryId);
    void runSync();
    return entry;
  }, [reload, bump, runSync]);

  const editEntry = useCallback(async (entryId: string, value: JournalEntryValue) => {
    await upsertEntry(value, entryId);
    await reload();
    bump(entryId);
    void runSync();
  }, [reload, bump, runSync]);

  // Soft-delete with a brief in-memory undo window, then commit a tombstone.
  // No persistence: if the tab closes before the window elapses, the entry
  // simply survives (the delete was never committed).
  const deleteEntry = useCallback(async (entryId: string) => {
    if (!doc.entries[entryId]) return;
    setPendingIds((prev) => new Set(prev).add(entryId));
    armUndoTimer(entryId, UNDO_WINDOW_MS);
  }, [doc]);

  const undoDelete = useCallback(async (entryId: string) => {
    clearTimeout(undoTimers.current.get(entryId));
    undoTimers.current.delete(entryId);
    setPendingIds((prev) => { const next = new Set(prev); next.delete(entryId); return next; });
  }, []);

  const importJson = useCallback(async (text: string) => {
    const result = await importJournalJson(text);
    if (result.ok) { await reload(); bump(); void runSync(); }
    return result;
  }, [reload, bump, runSync]);

  const groups = useMemo(() => group(doc, query, pendingIds), [doc, query, pendingIds]);
  const count = useMemo(() => activeEntries(doc).filter((e) => !pendingIds.has(e.entryId)).length, [doc, pendingIds]);

  useEffect(() => () => { for (const t of undoTimers.current.values()) clearTimeout(t); }, []);

  return {
    ready, usable, error, hasBackend: !!backend, connected, connect,
    groups, count, query, setQuery,
    addEntry, editEntry, deleteEntry, undoDelete, pendingDeleteIds: pendingIds,
    exportJson: exportJournalJson, importJson, syncNow: runSync,
  };
}

/** Clear the whole journal (Clear all local data — D12). */
export async function clearJournal(): Promise<void> {
  await clearDb();
}
