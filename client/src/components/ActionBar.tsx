// Persistent action bar — Share / Export / Import. Lives directly
// under the TabBar so the actions are reachable from any view (Camps,
// Schedule, Art, Map). Previously these buttons were inside the Camps
// tab's Toolbar, which meant they vanished on tab switch.
//
// Share + Export are gated on having SOMETHING to send (camps OR
// events OR art OR my-camp OR meet spots). Import is always
// available — it's where users restore a snapshot from another
// device, no prerequisites.
interface Props {
  onShare: () => void;
  onExport: () => void;
  onImport: () => void;
  /** True when the user has at least one camp/event/art starred OR
   *  a home camp set OR meet spots configured. Drives whether the
   *  Share + Export buttons are visible. */
  hasSomethingToSend: boolean;
}

export function ActionBar({
  onShare, onExport, onImport, hasSomethingToSend,
}: Props) {
  return (
    <div class="action-bar" role="toolbar" aria-label="Share / Export / Import">
      {hasSomethingToSend && (
        <button
          class="share-btn"
          type="button"
          title="Copy a share link"
          onClick={onShare}
        >
          <svg
            class="share-icon" viewBox="0 0 24 24"
            width="14" height="14" fill="none"
            stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <path d="M12 3v13" />
            <path d="M7 8l5-5 5 5" />
          </svg>
          {' '}Share
        </button>
      )}
      {hasSomethingToSend && (
        <button
          class="share-btn"
          type="button"
          title="Download a JSON snapshot — restore on another device with Import"
          onClick={onExport}
        >
          <span aria-hidden="true">⬇</span>{' '}Export
        </button>
      )}
      <button
        class="share-btn"
        type="button"
        title="Restore a JSON snapshot — pick a file you exported, or one a friend sent over"
        onClick={onImport}
      >
        <span aria-hidden="true">⬆</span>{' '}Import
      </button>
    </div>
  );
}
