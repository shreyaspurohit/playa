import { useEffect, useMemo, useState } from 'preact/hooks';
import type { JournalContext, JournalEntry, JournalEntryValue } from '../types';
import type { JournalController } from '../hooks/useJournal';
import { JournalEditor } from './JournalEditor';
import { JournalHero } from './JournalHero';
import { TimeOfDayIcon } from './TimeOfDayIcon';
import { defaultBurnYear } from '../utils/journalTime';
import { quoteForDay } from '../utils/journalQuotes';
import { JOURNAL_ADD_EVENT } from '../utils/journalEntryBus';
import { moodOption, timeOfDayFor } from '../utils/journalStore';
import { readString, writeString } from '../utils/storage';

// bm- prefixed so "Clear all local data" removes it too.
const BACKUP_NUDGE_KEY = 'bm-journal-backup-nudge';

const EMPTY_PROMPTS = [
  'What did the dust teach you today?',
  'Best thing you ate on playa?',
  'Who did you meet that you want to remember?',
  'What made you laugh out loud?',
  'A moment you never want to forget…',
  'What did you build, give, or receive?',
];

interface OpenEditor {
  id: string;                       // unique per open — used only as the editor's React key
  entryId?: string;
  initialValue?: JournalEntryValue;
  presetContext?: JournalContext;
}

function firstLine(text: string): string {
  const line = text.split('\n')[0].trim();
  return line.length > 80 ? line.slice(0, 80) + '…' : line;
}

function formatTime(occurredAt: string): string {
  const [hh, mm] = (occurredAt.split('T')[1] ?? '00:00').split(':').map(Number);
  const ampm = hh < 12 ? 'AM' : 'PM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${ampm}`;
}

function contextLine(context: JournalContext): string {
  const kind = context.kind === 'food' ? '🍽'
    : context.kind === 'event' ? '📅'
    : context.kind === 'art' ? '🎨' : '🏕';
  return context.campName && context.kind !== 'camp'
    ? `${kind} ${context.title} · ${context.campName}`
    : `${kind} ${context.title}`;
}

function downloadJournal(json: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `playa-journal-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickJournalFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      try { resolve(await file.text()); } catch { resolve(null); }
    };
    input.style.display = 'none';
    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 60_000);
  });
}

interface JournalViewProps {
  /** True in the locked shell (D16): the global menu (export/import/sync) is not
   *  reachable, so the journal surfaces its own connect/sync/export controls. In
   *  the normal app these live in the global Export/Import + menu Sync instead. */
  standalone?: boolean;
  journal: JournalController;
}

export function JournalView({ standalone = false, journal }: JournalViewProps) {
  const [editor, setEditor] = useState<OpenEditor | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [nudgeDismissed, setNudgeDismissed] = useState(() => readString(BACKUP_NUDGE_KEY, '') === '1');
  // Explicit per-day open/closed choices (true=open); a day with no entry here
  // falls back to the default: today + the newest day open, older collapsed.
  const [dayOpen, setDayOpen] = useState<Map<string, boolean>>(new Map());
  const currentYear = useMemo(defaultBurnYear, []);
  const emptyPrompt = useMemo(() => EMPTY_PROMPTS[Math.floor(Math.random() * EMPTY_PROMPTS.length)], []);
  const quote = useMemo(() => quoteForDay(), []);

  const todayKey = useMemo(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }, []);
  const allDayKeys = useMemo(
    () => journal.groups.flatMap((g) => g.days.map((day) => day.dayKey)),
    [journal.groups],
  );
  const newestDayKey = journal.groups[0]?.days[0]?.dayKey;
  const isDayOpen = (dayKey: string): boolean => {
    if (journal.query) return true;                     // a search must reveal every match
    const override = dayOpen.get(dayKey);
    if (override !== undefined) return override;
    return dayKey === todayKey || dayKey === newestDayKey;
  };
  const setAllDays = (open: boolean) => setDayOpen(new Map(allDayKeys.map((k) => [k, open])));

  const dismissNudge = () => { writeString(BACKUP_NUDGE_KEY, '1'); setNudgeDismissed(true); };
  // Nudge once they have something worth protecting, Dropbox exists, and they
  // haven't connected or dismissed it.
  const showBackupNudge = journal.ready && journal.hasBackend && !journal.connected
    && journal.count > 0 && !nudgeDismissed;

  // Open the editor with prefilled context when a camp/event/Food/art row asks (D4).
  useEffect(() => {
    const onAdd = (e: Event) => {
      const context = (e as CustomEvent<JournalContext>).detail;
      setEditor({ id: crypto.randomUUID(), presetContext: context });
    };
    window.addEventListener(JOURNAL_ADD_EVENT, onAdd);
    return () => window.removeEventListener(JOURNAL_ADD_EVENT, onAdd);
  }, []);

  const openNew = () => setEditor({ id: crypto.randomUUID() });
  const openEdit = (entry: JournalEntry) => setEditor({
    id: crypto.randomUUID(), entryId: entry.entryId, initialValue: entry.value,
  });

  const onExport = async () => {
    // Never hand back an empty file that looks like a real backup — if the store
    // can't be read, say so instead of downloading `{entries:{}}`.
    try {
      downloadJournal(await journal.exportJson());
    } catch {
      setNotice('Could not read your journal to export — your device storage may be unavailable.');
      setTimeout(() => setNotice(null), 5000);
    }
  };
  const onImport = async () => {
    const text = await pickJournalFile();
    if (text === null) return;
    const result = await journal.importJson(text);
    setNotice(result.ok ? 'Journal imported.' : 'That file was not a valid journal export.');
    setTimeout(() => setNotice(null), 4000);
  };

  if (!journal.ready) {
    return <section class="journal-wrap"><p class="journal-note">Loading your journal…</p></section>;
  }

  return (
    <section class="journal-wrap">
      <JournalHero />
      <blockquote class="journal-quote">
        “{quote.text}”
        <cite class="journal-quote-by">— {quote.by}</cite>
      </blockquote>
      <div class="journal-topline">
        <h2>Journal <span class="journal-year">{currentYear}</span></h2>
        <div class="journal-actions">
          <button
            type="button" class="primary-btn" onClick={openNew}
            disabled={!journal.usable}
            title={journal.usable ? undefined : 'Journaling is unavailable in this browser'}
          >＋ Add entry</button>
          {/* Export/Import and Sync live in the global menu; the locked shell
              (standalone) has no menu, so it surfaces them here. */}
          {standalone && <button type="button" class="subtle-btn" onClick={onExport}>Export</button>}
          {standalone && <button type="button" class="subtle-btn" onClick={onImport}>Import</button>}
          {standalone && journal.hasBackend && (journal.connected
            ? <button type="button" class="subtle-btn" onClick={() => void journal.syncNow()}>Sync</button>
            : <button type="button" class="subtle-btn" onClick={() => void journal.connect()}>Connect Dropbox</button>)}
        </div>
      </div>

      {showBackupNudge && (
        <div class="journal-backup-banner">
          <button type="button" class="journal-backup-dismiss" onClick={dismissNudge} aria-label="Dismiss">✕</button>
          <p class="journal-backup-text">
            Your journal lives only on this device. Connect Dropbox to back it up
            and sync it across your devices.
          </p>
          <button type="button" class="primary-btn" onClick={() => void journal.connect()}>Connect Dropbox</button>
        </div>
      )}

      {journal.error && <p class="journal-error">{journal.error}</p>}
      {notice && <p class="journal-note">{notice}</p>}

      {/* Search only appears once there are enough entries to warrant it — a
          prominent empty box up top was being mistaken for the entry field. */}
      {(journal.count > 3 || journal.query) && (
        <input
          class="journal-search"
          type="search"
          aria-label="Search your journal"
          placeholder="🔍 Search your journal…"
          value={journal.query}
          onInput={(e) => journal.setQuery((e.target as HTMLInputElement).value)}
        />
      )}

      {[...journal.pendingDeleteIds].map((id) => (
        <div key={id} class="journal-undo-bar">
          <span>Entry deleted.</span>
          <button type="button" class="subtle-btn" onClick={() => void journal.undoDelete(id)}>Undo</button>
        </div>
      ))}

      {editor && (
        <JournalEditor
          key={editor.id}
          entryId={editor.entryId}
          initialValue={editor.initialValue}
          presetContext={editor.presetContext}
          onSave={async (value, entryId) => { if (entryId) await journal.editEntry(entryId, value); else await journal.addEntry(value); }}
          onClose={() => setEditor(null)}
        />
      )}

      {journal.count === 0 && !journal.query && (
        <div class="journal-empty">
          <p class="journal-empty-prompt">{emptyPrompt}</p>
          <p>Tap <strong>Add entry</strong> to write your first memory — or add one from any camp, event, Food, or art.</p>
        </div>
      )}
      {journal.count > 0 && journal.groups.length === 0 && (
        <p class="journal-empty">
          No entries match your search.{' '}
          <button type="button" class="subtle-btn" onClick={() => journal.setQuery('')}>Clear search</button>
        </p>
      )}

      {journal.groups.map((groupYear, gi) => (
        <div key={groupYear.year} class="journal-year-group">
          <div class="journal-year-head">
            <h3 class="journal-year-title">{groupYear.year}</h3>
            {gi === 0 && allDayKeys.length > 1 && !journal.query && (
              <div class="journal-list-controls">
                <button
                  type="button" class="journal-collapse-btn"
                  title="Expand all days" aria-label="Expand all days"
                  onClick={() => setAllDays(true)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 5.83 15.17 9l1.41-1.41L12 3 7.41 7.59 8.83 9 12 5.83zm0 12.34L8.83 15l-1.41 1.41L12 21l4.59-4.59L15.17 15 12 18.17z"/></svg>
                </button>
                <button
                  type="button" class="journal-collapse-btn"
                  title="Collapse all days" aria-label="Collapse all days"
                  onClick={() => setAllDays(false)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7.41 18.59 8.83 20 12 16.83 15.17 20l1.41-1.41L12 14l-4.59 4.59zM16.59 5.41 15.17 4 12 7.17 8.83 4 7.41 5.41 12 10l4.59-4.59z"/></svg>
                </button>
              </div>
            )}
          </div>
          {groupYear.days.map((day) => (
            <details
              key={day.dayKey}
              class="journal-day-group"
              open={isDayOpen(day.dayKey)}
              onToggle={(e) => {
                // Ignore programmatic opens forced by an active search — only a
                // real user toggle should stick as an override.
                if (journal.query) return;
                const det = e.currentTarget as HTMLDetailsElement;
                setDayOpen((prev) => new Map(prev).set(day.dayKey, det.open));
              }}
            >
              <summary class="journal-day-head">
                <span class="journal-day-caret" aria-hidden="true">▸</span>
                <span class="journal-day-label">{day.dayLabel}</span>
                <span class="journal-day-count">{day.entries.length}</span>
              </summary>
              {day.entries.map((entry) => {
                const bucket = timeOfDayFor(entry.value!.occurredAt);
                const mood = moodOption(entry.value!.mood);
                return (
                  <details key={entry.entryId} class={'journal-card tod-' + bucket}>
                    <summary class="journal-card-summary">
                      <span class="journal-card-caret" aria-hidden="true">▸</span>
                      <span class="journal-tod"><TimeOfDayIcon bucket={bucket} /></span>
                      {mood && <span class="journal-mood" title={mood.label}>{mood.emoji}</span>}
                      <span class="journal-card-title">{entry.value!.title || firstLine(entry.value!.text)}</span>
                      <span class="journal-card-when">{formatTime(entry.value!.occurredAt)}</span>
                    </summary>
                    <div class="journal-card-body">
                      {entry.value!.context && <div class="journal-card-context">{contextLine(entry.value!.context)}</div>}
                      <p class="journal-card-text">{entry.value!.text}</p>
                      <div class="journal-card-actions">
                        <button type="button" class="subtle-btn" onClick={() => openEdit(entry)}>Edit</button>
                        <button type="button" class="subtle-btn" onClick={() => void journal.deleteEntry(entry.entryId)}>Delete</button>
                      </div>
                    </div>
                  </details>
                );
              })}
            </details>
          ))}
        </div>
      ))}
    </section>
  );
}
