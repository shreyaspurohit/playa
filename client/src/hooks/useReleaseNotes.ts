// Reads release notes embedded in the page (Python builder collects
// commits whose subject starts with `rn:`) and surfaces only the ones
// newer than the user's saved watermark — so the banner shows what
// changed since their last refresh, not the whole project history.
//
// First-ever visit: we set the watermark to the newest note's ts so
// returning users don't get spammed with backlog. Subsequent loads:
// any note with ts > watermark counts as "new since last visit."
import { useCallback, useEffect, useState } from 'preact/hooks';
import { LS } from '../types';
import { readString, writeString } from '../utils/storage';

export interface ReleaseNote {
  /** ISO timestamp of the commit (author date). */
  ts: string;
  /** Short SHA — purely cosmetic, useful in the banner for debugging. */
  sha: string;
  /** Commit subject minus the leading `rn:` prefix, trimmed. */
  message: string;
}

/** Read + validate the embedded `<script id="bm-release-notes">` JSON. */
function readEmbedded(): ReleaseNote[] {
  if (typeof document === 'undefined') return [];
  const el = document.getElementById('bm-release-notes');
  if (!el) return [];
  try {
    const parsed = JSON.parse(el.textContent ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is ReleaseNote =>
      !!n && typeof n === 'object'
      && typeof n.ts === 'string'
      && typeof n.sha === 'string'
      && typeof n.message === 'string',
    );
  } catch {
    return [];
  }
}

export function useReleaseNotes(): {
  pending: ReleaseNote[];
  dismiss: () => void;
} {
  const [pending, setPending] = useState<ReleaseNote[]>([]);

  useEffect(() => {
    const all = readEmbedded();
    if (all.length === 0) return;
    const newest = all[all.length - 1].ts;
    const seen = readString(LS.releaseNotesSeen, '');
    if (!seen) {
      // First-ever visit — anchor at the current newest so the user
      // doesn't see backlog. Subsequent builds will surface anything
      // with ts > this watermark.
      writeString(LS.releaseNotesSeen, newest);
      return;
    }
    // Lex-compare ISO-8601 timestamps. Notes are ordered oldest-first
    // by the builder; filter is straight string compare.
    const fresh = all.filter((n) => n.ts > seen);
    if (fresh.length > 0) setPending(fresh);
  }, []);

  const dismiss = useCallback(() => {
    if (pending.length === 0) return;
    const newest = pending[pending.length - 1].ts;
    writeString(LS.releaseNotesSeen, newest);
    setPending([]);
  }, [pending]);

  return { pending, dismiss };
}
