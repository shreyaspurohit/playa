// "What's new since your last visit" banner. Shows once after a fresh
// deploy, lists every `rn:` commit newer than the user's watermark,
// dismissed with one click. Same .import-banner shell as the share
// + snapshot import banners so it sits in the same visual slot.
import type { ReleaseNote } from '../hooks/useReleaseNotes';

interface Props {
  notes: ReleaseNote[];
  onDismiss: () => void;
}

export function ReleaseNotesBanner({ notes, onDismiss }: Props) {
  if (notes.length === 0) return null;
  // Newest first in the UI — most recent change is what the user
  // probably wants to see at the top of the list.
  const ordered = [...notes].reverse();
  return (
    <div class="import-banner" role="status" aria-live="polite">
      <div class="import-banner-body">
        <p>
          <strong>What's new</strong>
          {notes.length > 1 && <> &mdash; {notes.length} updates since your last visit</>}:
        </p>
        <ul class="release-notes-list">
          {ordered.map((n) => (
            <li key={n.sha}>{n.message}</li>
          ))}
        </ul>
        <div class="import-banner-actions">
          <button type="button" class="primary-btn" onClick={onDismiss}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
