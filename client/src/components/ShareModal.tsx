// Build + distribute a share URL that carries the user's full
// rendezvous layer: starred camps + events + art + home camp + meet
// spots — with PER-ITEM picker checkboxes so the user can opt items
// out of the share (default: everything starred is included).
//
// The nickname lives in the header pill (`NicknamePill`); this modal
// nudges the user there if it's unset.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Art, Camp, MeetSpot, Source } from '../types';
import { LS } from '../types';
import { readString } from '../utils/storage';
import { buildShareUrl, copyText } from '../utils/share';
import { IncludePicker } from './IncludePicker';

interface Props {
  open: boolean;
  campIds: string[];
  eventIds: string[];
  /** Starred art ids (optional — when empty, the share carries no
   *  art and the receiver's import banner doesn't mention art). */
  artIds?: string[];
  /** Lookup tables for the picker UI — name + subtitle per item. */
  camps: Camp[];
  art: Art[];
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
  open, campIds, eventIds, artIds = [],
  camps, art,
  myCampId, meetSpots, source,
  onClose, onRequestNickname,
}: Props) {
  const [nickname, setNickname] = useState(() => readString(LS.nickname, ''));
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<ShareStatus>('idle');

  // Per-category picker state. Each Set holds the IDs (camps, events,
  // art) currently selected for inclusion. `meetSpots` are picked by
  // index since they have no stable id. `includeMyCamp` is a single
  // toggle. All default to "everything in" — opening the modal is
  // a passive action, not a destructive one.
  const [pickedCamps, setPickedCamps] = useState<Set<string>>(() => new Set(campIds));
  const [pickedEvents, setPickedEvents] = useState<Set<string>>(() => new Set(eventIds));
  const [pickedArt, setPickedArt] = useState<Set<string>>(() => new Set(artIds));
  const [pickedMeetIdxs, setPickedMeetIdxs] = useState<Set<string>>(
    () => new Set(meetSpots.map((_, i) => String(i))),
  );
  const [includeMyCamp, setIncludeMyCamp] = useState(true);

  useEffect(() => {
    if (!open) return;
    setNickname(readString(LS.nickname, ''));
    setUrl('');
    setStatus('idle');
    // Re-seed pickers each time the modal opens so freshly starred
    // items show up checked by default and just-removed ones drop.
    setPickedCamps(new Set(campIds));
    setPickedEvents(new Set(eventIds));
    setPickedArt(new Set(artIds));
    setPickedMeetIdxs(new Set(meetSpots.map((_, i) => String(i))));
    setIncludeMyCamp(true);
  }, [open, campIds, eventIds, artIds, meetSpots]);

  // Lookup tables for the picker rows (name + subtitle).
  const campById = useMemo(() => {
    const m = new Map<string, Camp>();
    for (const c of camps) m.set(c.id, c);
    return m;
  }, [camps]);
  const artById = useMemo(() => {
    const m = new Map<string, Art>();
    for (const a of art) m.set(a.id, a);
    return m;
  }, [art]);
  // Event id → camp it belongs to, so the picker row can show
  // "at <camp name>".
  const eventToCamp = useMemo(() => {
    const m = new Map<string, Camp>();
    for (const c of camps) {
      for (const e of c.events ?? []) m.set(e.id, c);
    }
    return m;
  }, [camps]);

  const campItems = useMemo(
    () => campIds.map((id) => {
      const c = campById.get(id);
      return {
        id,
        name: c?.name || `Camp ${id}`,
        subtitle: c?.location || undefined,
      };
    }),
    [campIds, campById],
  );
  const eventItems = useMemo(
    () => eventIds.map((id) => {
      // Event names aren't stored in the camp index directly; walk to
      // find the matching event. Slower than O(1), but the count is
      // small (favorited events only).
      const camp = eventToCamp.get(id);
      const ev = camp?.events?.find((e) => e.id === id);
      return {
        id,
        name: ev?.name || `Event ${id}`,
        subtitle: camp ? `at ${camp.name}` : undefined,
      };
    }),
    [eventIds, eventToCamp],
  );
  const artItems = useMemo(
    () => artIds.map((id) => {
      const a = artById.get(id);
      return {
        id,
        name: a?.name || `Art ${id}`,
        subtitle: a?.artist ? `by ${a.artist}` : a?.location || undefined,
      };
    }),
    [artIds, artById],
  );
  const meetItems = useMemo(
    () => meetSpots.map((s, i) => ({
      id: String(i),
      name: s.label,
      subtitle: s.address,
    })),
    [meetSpots],
  );

  const myCampInfo = useMemo(
    () => (myCampId ? campById.get(myCampId) : undefined),
    [myCampId, campById],
  );

  function handleBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  async function build() {
    if (!nickname) return;
    // Use ONLY the items the user has checked. Preserves declaration
    // order from the source arrays so the receiver's view of the
    // share is stable across re-shares.
    const selectedCamps = campIds.filter((id) => pickedCamps.has(id));
    const selectedEvents = eventIds.filter((id) => pickedEvents.has(id));
    const selectedArt = artIds.filter((id) => pickedArt.has(id));
    const selectedMeet = meetSpots.filter((_, i) => pickedMeetIdxs.has(String(i)));
    const generated = buildShareUrl({
      name: nickname,
      campIds: selectedCamps,
      eventIds: selectedEvents,
      ...(selectedArt.length > 0 ? { artIds: selectedArt } : {}),
      ...(includeMyCamp && myCampId ? { myCampId } : {}),
      ...(selectedMeet.length > 0 ? { meetSpots: selectedMeet } : {}),
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

  const total = campIds.length + eventIds.length + artIds.length;
  const hasRendezvous = Boolean(myCampId) || meetSpots.length > 0;
  const nothingToShare = total === 0 && !hasRendezvous;

  // Live count of what's currently checked, drives the "Generate" button
  // label so the user sees what they're about to send.
  const willSend =
    pickedCamps.size + pickedEvents.size + pickedArt.size
    + pickedMeetIdxs.size + (includeMyCamp && myCampId ? 1 : 0);
  const willSendNone = willSend === 0;

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
              <div class="share-manifest">
                <p class="share-manifest-hint">
                  Everything starred is included by default — uncheck
                  anything you'd rather keep private.
                </p>
                <IncludePicker
                  title="Starred camps"
                  items={campItems}
                  selected={pickedCamps}
                  onChange={setPickedCamps}
                />
                <IncludePicker
                  title="Starred events"
                  items={eventItems}
                  selected={pickedEvents}
                  onChange={setPickedEvents}
                />
                <IncludePicker
                  title="Starred art"
                  items={artItems}
                  selected={pickedArt}
                  onChange={setPickedArt}
                />
                <IncludePicker
                  title="Meet spots"
                  items={meetItems}
                  selected={pickedMeetIdxs}
                  onChange={setPickedMeetIdxs}
                />
                {myCampId && (
                  <label class="include-row include-myhome">
                    <input
                      type="checkbox"
                      checked={includeMyCamp}
                      onChange={() => setIncludeMyCamp((v) => !v)}
                    />
                    <span class="include-row-body">
                      <span class="include-row-name">Your home camp</span>
                      {myCampInfo && (
                        <span class="include-row-subtitle">
                          {myCampInfo.name}
                          {myCampInfo.location ? ` · ${myCampInfo.location}` : ''}
                        </span>
                      )}
                    </span>
                  </label>
                )}
              </div>
              <p>
                <button
                  class="primary-btn"
                  type="button"
                  onClick={build}
                  disabled={willSendNone}
                  title={willSendNone
                    ? 'Pick at least one item to share'
                    : `Generate a link with ${willSend} item${willSend === 1 ? '' : 's'}`}
                >
                  Generate &amp; copy link{willSendNone ? '' : ` (${willSend})`}
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
