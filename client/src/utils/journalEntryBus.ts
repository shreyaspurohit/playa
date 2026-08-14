// Tiny bus so a camp / event / Food row can open the Journal editor with its
// context prefilled (ADR 20 D4) without threading props through every view.
// The row dispatches a request and routes to the Journal tab; the mounted
// JournalView listens and opens its editor.

import type { JournalContext } from '../types';

export const JOURNAL_ADD_EVENT = 'playa-journal-add';
export const JOURNAL_CHANNEL = 'playa-journal';

/** Tell any mounted JournalView (this tab or others) to reload from IndexedDB —
 *  used after the shared Dropbox sync updates the journal DB. */
export function notifyJournalChanged(): void {
  try {
    if ('BroadcastChannel' in window) {
      const ch = new BroadcastChannel(JOURNAL_CHANNEL);
      ch.postMessage({ type: 'journal-changed' });
      ch.close();
    }
  } catch { /* ignore */ }
}

export function requestJournalEntry(context: JournalContext): void {
  try {
    window.dispatchEvent(new CustomEvent<JournalContext>(JOURNAL_ADD_EVENT, { detail: context }));
  } catch { /* ignore */ }
  // Route to the Journal tab (preserves any other fragment params minimally).
  location.hash = '#journal';
}
