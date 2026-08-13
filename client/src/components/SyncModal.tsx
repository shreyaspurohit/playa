import { useEffect, useRef } from 'preact/hooks';
import type { SyncController } from '../hooks/useSync';
import { SyncSettings } from './SyncSettings';

export function SyncModal({
  open,
  sync,
  onClose,
}: {
  open: boolean;
  sync: SyncController;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  if (!sync.available) return null;

  return (
    <div
      class={'modal sync-modal' + (open ? '' : ' modal-hidden')}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sync-modal-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div class="modal-card sync-modal-card">
        <div class="modal-head">
          <h2 id="sync-modal-title">Dropbox sync</h2>
          <button
            ref={closeRef}
            class="modal-close"
            type="button"
            aria-label="Close Dropbox sync"
            onClick={onClose}
          >✕</button>
        </div>
        <div class="modal-body">
          <SyncSettings sync={sync} showHeading={false} />
        </div>
      </div>
    </div>
  );
}
