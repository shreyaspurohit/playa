import { useMemo, useState } from 'preact/hooks';
import type { JournalContext, JournalEntryValue } from '../types';
import { cleanEntryValue, MAX_TEXT_BYTES, MOODS } from '../utils/journalStore';
import {
  currentOccurredAt, defaultBurnYear, joinOccurredAt, splitOccurredAt,
} from '../utils/journalTime';

interface Props {
  entryId?: string;                 // set when editing an existing entry
  initialValue?: JournalEntryValue; // present when editing
  presetContext?: JournalContext;   // prefilled when opened from a camp/event/Food/art row
  onSave: (value: JournalEntryValue, entryId?: string) => void | Promise<void>;
  onClose: () => void;
}

function contextLabel(context: JournalContext): string {
  const kind = context.kind === 'food' ? 'Food'
    : context.kind === 'event' ? 'Event'
    : context.kind === 'art' ? 'Art' : 'Camp';
  return context.campName && context.kind !== 'camp'
    ? `${kind}: ${context.title} · ${context.campName}`
    : `${kind}: ${context.title}`;
}

export function JournalEditor({ entryId, initialValue, presetContext, onSave, onClose }: Props) {
  const seed = useMemo(() => {
    const occurredAt = initialValue?.occurredAt ?? currentOccurredAt();
    return {
      title: initialValue?.title ?? '',
      text: initialValue?.text ?? '',
      ...splitOccurredAt(occurredAt),
      burnYear: initialValue?.burnYear ?? defaultBurnYear(),
      mood: initialValue?.mood,
      context: initialValue?.context ?? presetContext,
      createdAt: initialValue?.createdAt ?? Date.now(),
    };
  }, [initialValue, presetContext]);

  const [title, setTitle] = useState(seed.title);
  const [text, setText] = useState(seed.text);
  const [mood, setMood] = useState<string | undefined>(seed.mood);
  const [date, setDate] = useState(seed.date);
  const [time, setTime] = useState(seed.time);
  const [burnYear, setBurnYear] = useState(seed.burnYear);
  const [context, setContext] = useState<JournalContext | undefined>(seed.context);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (saving) return;
    const validated = cleanEntryValue({
      burnYear, occurredAt: joinOccurredAt(date, time), createdAt: seed.createdAt, title, text,
      ...(mood ? { mood } : {}),
      ...(context ? { context } : {}),
    });
    if (!validated) {
      if (!text.trim()) setError('Write something first.');
      else if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES) setError('This entry is very long — please shorten it a little.');
      else setError('Please check the date and time.');
      return;
    }
    setSaving(true);
    try {
      await onSave(validated, entryId);
      onClose();
    } catch {
      setSaving(false);
      setError('Could not save — your device storage may be unavailable.');
    }
  };

  return (
    <form class="journal-editor" onSubmit={submit}>
      <div class="journal-editor-head">
        <strong>{entryId ? 'Edit entry' : 'New journal entry'}</strong>
        <button type="button" class="subtle-btn" onClick={onClose} aria-label="Close editor">✕</button>
      </div>

      {context && (
        <div class="journal-context-chip">
          <span>{contextLabel(context)}</span>
          <button type="button" class="subtle-btn" onClick={() => setContext(undefined)}>remove</button>
        </div>
      )}

      <input
        class="journal-title-input"
        type="text"
        value={title}
        autofocus
        maxLength={200}
        placeholder="Title (optional)"
        onInput={(e) => { setTitle((e.target as HTMLInputElement).value); setError(null); }}
      />
      <textarea
        class="journal-textarea"
        value={text}
        rows={6}
        placeholder="What happened?"
        onInput={(e) => { setText((e.target as HTMLTextAreaElement).value); setError(null); }}
      />
      <div class="journal-mood-block">
        <span class="journal-mood-label">Mood <span class="journal-mood-optional">(optional)</span></span>
        <div class="journal-mood-picker" role="group" aria-label="Mood">
          {MOODS.map((m) => (
            <button
              key={m.key}
              type="button"
              class={'journal-mood-opt' + (mood === m.key ? ' on' : '')}
              aria-pressed={mood === m.key ? 'true' : 'false'}
              onClick={() => setMood(mood === m.key ? undefined : m.key)}
            ><span class="mood-emoji" aria-hidden="true">{m.emoji}</span>{m.label}</button>
          ))}
        </div>
      </div>
      <div class="journal-editor-meta">
        <label>Date <input type="date" value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} /></label>
        <label>Time <input type="time" value={time} onInput={(e) => setTime((e.target as HTMLInputElement).value)} /></label>
        <label>Year <input type="number" value={burnYear} min={2000} max={2100}
          onInput={(e) => setBurnYear(parseInt((e.target as HTMLInputElement).value, 10) || burnYear)} /></label>
      </div>

      {error && <p class="journal-error">{error}</p>}
      <div class="journal-editor-actions">
        <button type="submit" class="primary-btn" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" class="subtle-btn" onClick={onClose} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
}
