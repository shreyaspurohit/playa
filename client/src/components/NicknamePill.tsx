// Displays the user's sharing nickname as a small header pill and lets
// them edit it in a focused prompt. One source of truth for the value
// (LS.nickname) that the share flow and the "my camp" / meet-spots
// features all read from. Setting it once here means no more repeat
// prompts when sharing.

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { LS } from '../types';
import { readString, writeString } from '../utils/storage';
import { friendChipStyle } from '../utils/friendColor';

/** Same size limits the share-decoder enforces on the receiver side.
 *  Keeping them mirrored here means the editor rejects bad input
 *  before it's even saved, not three steps later when the share URL
 *  fails to decode on a friend's device. */
const MAX_LEN = 64;

export function NicknamePill() {
  const [name, setName] = useState<string>(() => readString(LS.nickname, ''));
  const [open, setOpen] = useState(false);

  // Re-read on every open in case another tab wrote to LS.nickname
  // between mounts.
  const openEditor = useCallback(() => {
    setName(readString(LS.nickname, ''));
    setOpen(true);
  }, []);

  const onSave = useCallback((next: string) => {
    const trimmed = next.trim().slice(0, MAX_LEN);
    writeString(LS.nickname, trimmed);
    setName(trimmed);
    setOpen(false);
  }, []);

  // Multi-tab sync — another tab editing the nickname propagates to
  // this pill (and to anywhere else that reads it via storage events).
  useEffect(() => {
    const win = typeof window !== 'undefined' ? window : null;
    if (!win) return;
    function onStorage(e: StorageEvent) {
      if (e.key !== null && e.key !== LS.nickname) return;
      setName(readString(LS.nickname, ''));
    }
    win.addEventListener('storage', onStorage);
    return () => win.removeEventListener('storage', onStorage);
  }, []);

  return (
    <>
      <button
        type="button"
        class={'nickname-pill' + (name ? '' : ' empty')}
        onClick={openEditor}
        title={name ? `Your nickname — tap to edit` : 'Set your nickname for sharing'}
        style={name ? friendChipStyle(name) : undefined}
      >
        {name ? (
          <>
            {name}
            <span class="nickname-pill-edit" aria-hidden="true">✎</span>
          </>
        ) : (
          <>👋 Set nickname</>
        )}
      </button>
      {open && (
        <NicknameEditor
          initial={name}
          onSave={onSave}
          onCancel={() => setOpen(false)}
        />
      )}
    </>
  );
}

function NicknameEditor({
  initial, onSave, onCancel,
}: {
  initial: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(initial);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  function onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onCancel();
  }

  function submit(e?: Event) {
    e?.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSave(trimmed);
  }

  return (
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nickname-title"
      onClick={onBackdrop}
    >
      <div class="modal-card nickname-card">
        <div class="modal-head">
          <h2 id="nickname-title">Your nickname</h2>
          <button
            class="modal-close" type="button"
            aria-label="Close" onClick={onCancel}
          >✕</button>
        </div>
        <div class="modal-body">
          <p>
            This is how friends see you when you share a list with them —
            and how your name shows up on their map when they import
            your stuff.
          </p>
          <form onSubmit={submit}>
            <input
              ref={inputRef}
              type="text"
              class="share-input"
              placeholder="e.g. Alice"
              maxLength={MAX_LEN}
              value={draft}
              onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
            />
            <div class="nickname-actions">
              <button
                class="primary-btn" type="submit"
                disabled={!draft.trim()}
              >
                Save
              </button>
              <button
                class="subtle-btn" type="button" onClick={onCancel}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
