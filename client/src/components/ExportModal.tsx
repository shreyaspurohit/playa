// "What do you want to export?" modal — mirrors ShareModal but for
// JSON snapshots. Default = full snapshot (current behavior); the
// picker lets the user opt items out before download.
//
// Snapshot shape: see `client/src/utils/exportImport.ts`. The
// `friends` map is included unconditionally — it's per-source state
// that doesn't benefit from per-item picking, and snapshots are the
// path users take to migrate between devices.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Art, Camp, MeetSpot, Source } from '../types';
import { LS } from '../types';
import { readString } from '../utils/storage';
import { buildSnapshot, downloadSnapshot } from '../utils/exportImport';
import type { Snapshot } from '../utils/exportImport';
import { IncludePicker } from './IncludePicker';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Active source — matches buildSnapshot/applySnapshot scoping. */
  source: Source;
  /** Lookup tables for the picker labels. */
  camps: Camp[];
  art: Art[];
  /** What's currently starred / set in LS for the active source.
   *  These come from the same hooks that feed the camps/art views,
   *  so the modal sees the live state. */
  campIds: string[];
  eventIds: string[];
  artIds: string[];
  myCampId: string;
  meetSpots: MeetSpot[];
}

export function ExportModal({
  open, onClose, source,
  camps, art,
  campIds, eventIds, artIds, myCampId, meetSpots,
}: Props) {
  const [pickedCamps, setPickedCamps] = useState<Set<string>>(() => new Set(campIds));
  const [pickedEvents, setPickedEvents] = useState<Set<string>>(() => new Set(eventIds));
  const [pickedArt, setPickedArt] = useState<Set<string>>(() => new Set(artIds));
  const [pickedMeetIdxs, setPickedMeetIdxs] = useState<Set<string>>(
    () => new Set(meetSpots.map((_, i) => String(i))),
  );
  const [includeMyCamp, setIncludeMyCamp] = useState(true);
  const [includeFriends, setIncludeFriends] = useState(true);
  const [includeNickname, setIncludeNickname] = useState(true);

  useEffect(() => {
    if (!open) return;
    setPickedCamps(new Set(campIds));
    setPickedEvents(new Set(eventIds));
    setPickedArt(new Set(artIds));
    setPickedMeetIdxs(new Set(meetSpots.map((_, i) => String(i))));
    setIncludeMyCamp(true);
    setIncludeFriends(true);
    setIncludeNickname(true);
  }, [open, campIds, eventIds, artIds, meetSpots]);

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
  const eventToCamp = useMemo(() => {
    const m = new Map<string, Camp>();
    for (const c of camps) for (const e of c.events ?? []) m.set(e.id, c);
    return m;
  }, [camps]);

  const campItems = useMemo(
    () => campIds.map((id) => {
      const c = campById.get(id);
      return { id, name: c?.name || `Camp ${id}`, subtitle: c?.location };
    }),
    [campIds, campById],
  );
  const eventItems = useMemo(
    () => eventIds.map((id) => {
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
        subtitle: a?.artist ? `by ${a.artist}` : a?.location,
      };
    }),
    [artIds, artById],
  );
  const meetItems = useMemo(
    () => meetSpots.map((s, i) => ({
      id: String(i), name: s.label, subtitle: s.address,
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

  function exportNow() {
    // Read the full snapshot, then mask out anything the user
    // unchecked. Friends + nickname are kept all-or-nothing.
    const full = buildSnapshot(source);
    const filtered: Snapshot = {
      ...full,
      nickname: includeNickname ? full.nickname : '',
      campFavs: full.campFavs.filter((id) => pickedCamps.has(id)),
      eventFavs: full.eventFavs.filter((id) => pickedEvents.has(id)),
      artFavs: full.artFavs?.filter((id) => pickedArt.has(id)),
      myCampId: includeMyCamp ? full.myCampId : '',
      meetSpots: full.meetSpots.filter((_, i) => pickedMeetIdxs.has(String(i))),
      friends: includeFriends ? full.friends : {},
    };
    if (!filtered.artFavs || filtered.artFavs.length === 0) {
      delete filtered.artFavs;
    }
    downloadSnapshot(filtered);
    onClose();
  }

  const willExport =
    pickedCamps.size + pickedEvents.size + pickedArt.size
    + pickedMeetIdxs.size
    + (includeMyCamp && myCampId ? 1 : 0);
  const friendCount = useMemo(() => {
    try {
      const raw = readString(`${LS.sharedFavs}/${source}`, '');
      if (!raw) return 0;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? Object.keys(parsed).length : 0;
    } catch { return 0; }
  }, [source, open]);

  return (
    <div
      class={'modal' + (open ? '' : ' modal-hidden')}
      role="dialog" aria-modal="true" aria-labelledby="export-title"
      onClick={handleBackdrop}
    >
      <div class="modal-card">
        <div class="modal-head">
          <h2 id="export-title">Export your data</h2>
          <button class="modal-close" type="button" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div class="modal-body">
          <p>
            Downloads a JSON snapshot you can import on another
            device. Pick what to include — defaults to everything for
            the active source ({source}).
          </p>
          <div class="share-manifest">
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
            <label class="include-row">
              <input
                type="checkbox"
                checked={includeNickname}
                onChange={() => setIncludeNickname((v) => !v)}
              />
              <span class="include-row-body">
                <span class="include-row-name">Your nickname</span>
                <span class="include-row-subtitle">
                  Used as the export filename + as your sender name
                  if the imported snapshot is shared.
                </span>
              </span>
            </label>
            {friendCount > 0 && (
              <label class="include-row">
                <input
                  type="checkbox"
                  checked={includeFriends}
                  onChange={() => setIncludeFriends((v) => !v)}
                />
                <span class="include-row-body">
                  <span class="include-row-name">
                    Imported friends ({friendCount})
                  </span>
                  <span class="include-row-subtitle">
                    Other people's lists you've imported. All-or-nothing.
                  </span>
                </span>
              </label>
            )}
          </div>
          <p>
            <button
              class="primary-btn"
              type="button"
              onClick={exportNow}
              disabled={willExport === 0 && !includeFriends && !includeNickname}
            >
              Download snapshot{willExport > 0 ? ` (${willExport} item${willExport === 1 ? '' : 's'})` : ''}
            </button>
            <button
              class="secondary-btn"
              type="button"
              onClick={onClose}
              style={{ marginLeft: '8px' }}
            >Cancel</button>
          </p>
        </div>
      </div>
    </div>
  );
}
