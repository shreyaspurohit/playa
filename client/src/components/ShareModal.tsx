// Build + distribute a share URL that carries the user's full
// rendezvous layer: starred camps + events + home camp + meet spots.
// The nickname now lives in the header pill (`NicknamePill`), so this
// modal doesn't prompt — if it's unset we nudge the user there
// instead. Each time the modal opens it re-reads the latest nickname
// from LS so an in-session edit is reflected immediately.
import { useEffect, useState } from 'preact/hooks';
import type { MeetSpot, Source } from '../types';
import { LS } from '../types';
import { readString } from '../utils/storage';
import { buildShareUrl, copyText } from '../utils/share';

interface Props {
  open: boolean;
  campIds: string[];
  eventIds: string[];
  /** Sender's home camp id (or ''). Gets folded into the payload. */
  myCampId: string;
  /** Sender's rendezvous plans. */
  meetSpots: MeetSpot[];
  /** Active source — embedded in the share so the receiver can route
   *  the import into the matching per-source bucket. */
  source: Source;
  onClose: () => void;
  /** Jumps the user to the nickname-edit UI in the header when they
   *  haven't set one yet. Keeps this modal focused on the "send" action. */
  onRequestNickname?: () => void;
}

/** How the generated link left the modal. */
type ShareStatus = 'idle' | 'shared' | 'copied' | 'fail';

export function ShareModal({
  open, campIds, eventIds, myCampId, meetSpots, source,
  onClose, onRequestNickname,
}: Props) {
  const [nickname, setNickname] = useState(() => readString(LS.nickname, ''));
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<ShareStatus>('idle');

  useEffect(() => {
    if (!open) return;
    setNickname(readString(LS.nickname, ''));
    setUrl('');
    setStatus('idle');
  }, [open]);

  function handleBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  async function build() {
    if (!nickname) return;
    const generated = buildShareUrl({
      name: nickname,
      campIds, eventIds,
      ...(myCampId ? { myCampId } : {}),
      ...(meetSpots.length > 0 ? { meetSpots } : {}),
      source,
    });
    setUrl(generated);

    // Prefer the native share sheet on mobile — one tap → Messages /
    // WhatsApp / etc. Falls back to clipboard on desktop (where
    // navigator.share is usually unavailable) or when the user
    // dismisses the sheet.
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'Playa Camps',
          text: `${nickname}'s list`,
          url: generated,
        });
        setStatus('shared');
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          setStatus('idle');
          return;
        }
      }
    }
    const ok = await copyText(generated);
    setStatus(ok ? 'copied' : 'fail');
  }

  const total = campIds.length + eventIds.length;
  const hasRendezvous = Boolean(myCampId) || meetSpots.length > 0;
  const nothingToShare = total === 0 && !hasRendezvous;

  return (
    <div
      class={'modal' + (open ? '' : ' modal-hidden')}
      role="dialog" aria-modal="true" aria-labelledby="share-title"
      onClick={handleBackdrop}
    >
      <div class="modal-card">
        <div class="modal-head">
          <h2 id="share-title">Share your list</h2>
          <button class="modal-close" type="button" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div class="modal-body">
          {!nickname ? (
            <>
              <p>
                Set a <strong>nickname</strong> first so friends can see
                whose list they're importing. The nickname pill is in the
                header — tap it to enter one.
              </p>
              {onRequestNickname && (
                <p>
                  <button
                    class="primary-btn" type="button"
                    onClick={() => { onClose(); onRequestNickname(); }}
                  >
                    Set nickname
                  </button>
                </p>
              )}
            </>
          ) : nothingToShare ? (
            <p>
              Nothing to share yet. Go star some camps or events, mark one
              camp as <strong>my camp</strong>, or add a meet spot on the
              Map. Then come back here.
            </p>
          ) : (
            <>
              <p>
                You'll send a link as <strong>{nickname}</strong>. The
                link itself carries everything — nothing is uploaded
                anywhere; it rides in the URL fragment.
              </p>
              <ul class="share-manifest">
                {campIds.length > 0 && (
                  <li>
                    <strong>{campIds.length}</strong> starred{' '}
                    camp{campIds.length === 1 ? '' : 's'}
                  </li>
                )}
                {eventIds.length > 0 && (
                  <li>
                    <strong>{eventIds.length}</strong> starred{' '}
                    event{eventIds.length === 1 ? '' : 's'}
                  </li>
                )}
                {myCampId && <li>Your home camp</li>}
                {meetSpots.length > 0 && (
                  <li>
                    <strong>{meetSpots.length}</strong> meet{' '}
                    spot{meetSpots.length === 1 ? '' : 's'}
                  </li>
                )}
              </ul>
              <p>
                <button class="primary-btn" type="button" onClick={build}>
                  Generate &amp; copy link
                </button>
              </p>
              {url && (
                <>
                  <p class="footnote">
                    {status === 'shared' && <><strong>✓ Shared.</strong> Pick a contact or app to send the link to.</>}
                    {status === 'copied' && <><strong>✓ Copied to clipboard.</strong> Paste it into a message to your friends.</>}
                    {status === 'fail' && <><strong>Couldn't share or copy</strong> — select the URL below and copy manually.</>}
                  </p>
                  <textarea
                    class="share-url"
                    readOnly
                    rows={3}
                    onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                  >{url}</textarea>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
