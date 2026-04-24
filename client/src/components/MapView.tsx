// Static SVG renderer of Black Rock City. No external tiles, no
// network — works offline once the site has loaded. Plots starred camps
// as pins and, if the user grants GPS, shows a "you are here" dot plus
// a bearing line to the selected target.
//
// Coordinates:
//   - SVG viewBox spans ±6000 ft centered on the Man
//   - 12:00 points up. Clockwise as you'd read a real clock.
//   - Lat/lng → ft via haversine + compass rotation (see utils/address).
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Camp, MeetSpot } from '../types';
import type { BrcPOI } from '../map/data';
import { BRC, POIS } from '../map/data';
import {
  addressToSvgFeet, addressToLatLng, bearingDeg, haversineMeters,
  latLngToSvgFeet, latLngToAddress, parseAddress,
} from '../map/address';
import { useGeolocation } from '../hooks/useGeolocation';
import { friendChipStyle } from '../utils/friendColor';
import { MapInfoModal } from './MapInfoModal';
import { MeetSpotEditor } from './MeetSpotEditor';
import { TrashIcon } from './TrashIcon';

/** Friend-side data imported from share links. Each entry is one
 *  friend's full "rendezvous layer" — their home camp (if set) plus
 *  whatever meet spots they authored. Kept as a single prop so
 *  MapView doesn't have to know about the storage/friends lookup. */
export interface FriendRendezvous {
  name: string;
  myCampId?: string;
  meetSpots?: MeetSpot[];
}

interface Props {
  camps: Camp[];
  favCampIds: Set<string>;
  friendFavCampIds: (id: string) => string[];
  favEventIds: Set<string>;
  friendFavEventIds: (id: string) => string[];
  /** The user's own home camp id ('' when unset). Renders a dedicated
   *  accent-colored pin. Shared with friends via the share link. */
  myCampId: string;
  /** The user's own meet spots. Each renders a diamond pin on the
   *  map. Friends' spots are layered on top when they import. */
  meetSpots: MeetSpot[];
  onAddMeetSpot: (spot: MeetSpot) => void;
  onRemoveMeetSpot: (idx: number) => void;
  /** Every friend whose imported data carries a myCampId or meetSpots
   *  — used to draw their camp + rendezvous pins on the map, tinted
   *  with their per-name hash color. */
  friendsRendezvous: FriendRendezvous[];
  /** If a specific camp is the current navigation target, pass it here. */
  initialTargetId?: string | null;
  onClearTarget?: () => void;
  onGotoCamp: (campId: string) => void;
}

const VIEWBOX_RADIUS = 6000; // ft — ~50% buffer past K street (left/right/bottom)
// City lives on the 2→6→10 bottom arc; the top half is mostly empty
// open playa. Crop the viewBox so the top margin is just enough for
// the 2:00 + 10:00 hour labels (at y≈-2875) with breathing room.
const VIEWBOX_TOP_MARGIN = 3300;

export function MapView({
  camps, favCampIds, friendFavCampIds,
  favEventIds, friendFavEventIds,
  myCampId, meetSpots, onAddMeetSpot, onRemoveMeetSpot,
  friendsRendezvous,
  initialTargetId = null, onClearTarget, onGotoCamp,
}: Props) {
  const [targetId, setTargetId] = useState<string | null>(initialTargetId);
  useEffect(() => { setTargetId(initialTargetId); }, [initialTargetId]);

  const [infoOpen, setInfoOpen] = useState(false);
  const [addingSpot, setAddingSpot] = useState(false);
  // Selected meet spot (mine or a friend's). Mutually exclusive with
  // `targetId` (the camp-selection path). Whichever the user last
  // clicked is the one whose details show near the Man.
  const [selectedSpot, setSelectedSpot] = useState<
    | { source: 'mine'; idx: number }
    | { source: 'friend'; name: string; idx: number }
    | null
  >(null);

  const { state: geo, request: requestGps, stop: stopGps } = useGeolocation();

  // Your own meet-spot pins — computed once per meetSpots change.
  const myMeetPins = useMemo(() => {
    return meetSpots
      .map((spot, idx) => {
        const pt = addressToSvgFeet(spot.address);
        return pt ? { spot, idx, x: pt.x, y: pt.y } : null;
      })
      .filter(Boolean) as Array<{ spot: MeetSpot; idx: number; x: number; y: number }>;
  }, [meetSpots]);

  // Friends' camps (from their imported myCampId + our camps list).
  const friendCampPins = useMemo(() => {
    const campsById = new Map(camps.map((c) => [c.id, c]));
    const out: Array<{ name: string; camp: Camp; x: number; y: number }> = [];
    for (const fr of friendsRendezvous) {
      if (!fr.myCampId) continue;
      const camp = campsById.get(fr.myCampId);
      if (!camp) continue;
      const pt = addressToSvgFeet(camp.location);
      if (!pt) continue;
      out.push({ name: fr.name, camp, x: pt.x, y: pt.y });
    }
    return out;
  }, [friendsRendezvous, camps]);

  // Friends' meet-spot pins, flattened across everyone. `idx` is the
  // position within THAT friend's own spots array — carries through to
  // the selectedSpot state so click → select round-trips cleanly.
  const friendMeetPins = useMemo(() => {
    const out: Array<{ name: string; spot: MeetSpot; idx: number; x: number; y: number }> = [];
    for (const fr of friendsRendezvous) {
      (fr.meetSpots ?? []).forEach((spot, idx) => {
        const pt = addressToSvgFeet(spot.address);
        if (!pt) return;
        out.push({ name: fr.name, spot, idx, x: pt.x, y: pt.y });
      });
    }
    return out;
  }, [friendsRendezvous]);

  // Static POI pins (Center Camp, Playa Info, etc. from map/data.ts).
  // Resolved once per BRC refresh — addresses don't change within a
  // build, so this memo is effectively constant.
  const poiPins = useMemo(() => {
    return POIS
      .map((poi) => {
        const pt = addressToSvgFeet(poi.address);
        return pt ? { poi, x: pt.x, y: pt.y } : null;
      })
      .filter(Boolean) as Array<{ poi: BrcPOI; x: number; y: number }>;
  }, []);

  // Your own camp, if set — rendered as a dedicated accent pin.
  const myCampPin = useMemo(() => {
    if (!myCampId) return null;
    const camp = camps.find((c) => c.id === myCampId);
    if (!camp) return null;
    const pt = addressToSvgFeet(camp.location);
    return pt ? { camp, x: pt.x, y: pt.y } : null;
  }, [myCampId, camps]);

  // Resolve the current selectedSpot state into the concrete data
  // needed to draw the highlight + sidebar target box.
  const activeSpot = useMemo(() => {
    if (!selectedSpot) return null;
    if (selectedSpot.source === 'mine') {
      const m = myMeetPins.find((p) => p.idx === selectedSpot.idx);
      if (!m) return null;
      return {
        label: m.spot.label, address: m.spot.address, when: m.spot.when,
        x: m.x, y: m.y, author: null as string | null,
      };
    }
    const f = friendMeetPins.find(
      (p) => p.name === selectedSpot.name && p.idx === selectedSpot.idx,
    );
    if (!f) return null;
    return {
      label: f.spot.label, address: f.spot.address, when: f.spot.when,
      x: f.x, y: f.y, author: f.name,
    };
  }, [selectedSpot, myMeetPins, friendMeetPins]);

  // Unified "clear any selection" — the SVG backdrop + Clear buttons
  // both need to drop camp AND spot highlights.
  function clearSelection() {
    setTargetId(null);
    setSelectedSpot(null);
    onClearTarget?.();
  }

  // Pins: camps the user has starred (own or friends').
  const pins = useMemo(() => {
    return camps
      .filter((c) => favCampIds.has(c.id) || friendFavCampIds(c.id).length > 0)
      .map((camp) => {
        const pt = addressToSvgFeet(camp.location);
        if (!pt) return null;
        const mine = favCampIds.has(camp.id);
        const friends = friendFavCampIds(camp.id);
        return { camp, x: pt.x, y: pt.y, mine, friends };
      })
      .filter(Boolean) as Array<{
        camp: Camp; x: number; y: number; mine: boolean; friends: string[];
      }>;
  }, [camps, favCampIds, friendFavCampIds]);

  const target = targetId ? pins.find((p) => p.camp.id === targetId) ?? null : null;

  // User GPS → SVG coordinates (only when we have a fix)
  const userSvg = geo.status === 'ready'
    ? latLngToSvgFeet({ lat: geo.lat, lng: geo.lng })
    : null;

  // User GPS → BRC address (e.g. "6:30 & B") for the situational-
  // awareness readout in the map header. Null when outside the rings.
  const userAddress = geo.status === 'ready'
    ? latLngToAddress({ lat: geo.lat, lng: geo.lng })
    : null;

  // Walk + bike time at conservative playa speeds. Flat ground but
  // soft dust + costumes + distractions → 4 km/h walk, 12 km/h bike.
  // Returns whole minutes, rounded up for anything > 0.5 min so the
  // estimate never reads as "0 min" for something genuinely measurable.
  function etaMinutes(meters: number): { walk: number; bike: number } {
    // 4 km/h = 66.67 m/min · 12 km/h = 200 m/min
    const walk = Math.max(1, Math.round(meters / 66.67));
    const bike = Math.max(1, Math.round(meters / 200));
    return { walk, bike };
  }

  // Same bearing/distance/ETA math but for the active meet spot.
  const spotInfo = useMemo(() => {
    if (!activeSpot || geo.status !== 'ready') return null;
    const latLng = addressToLatLng(activeSpot.address);
    if (!latLng) return null;
    const user = { lat: geo.lat, lng: geo.lng };
    const meters = haversineMeters(user, latLng);
    const brng = bearingDeg(user, latLng);
    return { meters, bearing: brng };
  }, [activeSpot, geo]);

  // Bearing + distance to target camp.
  const targetInfo = useMemo(() => {
    if (!target || geo.status !== 'ready') return null;
    const targetLatLng = addressToLatLng(target.camp.location);
    if (!targetLatLng) return null;
    const user = { lat: geo.lat, lng: geo.lng };
    const meters = haversineMeters(user, targetLatLng);
    const brng = bearingDeg(user, targetLatLng);
    return { meters, bearing: brng, targetLatLng };
  }, [target, geo]);

  function externalMapsUrl(c: Camp) {
    const ll = addressToLatLng(c.location);
    if (!ll) return null;
    return `https://www.google.com/maps?q=${ll.lat},${ll.lng}`;
  }

  return (
    <div class="map-wrap">
      <div class="map-head">
        <div>
          <h3 class="map-title">Black Rock City {BRC.year}</h3>
          <p class="map-sub">
            The Man at <code>{BRC.center.lat.toFixed(6)}, {BRC.center.lng.toFixed(6)}</code>
            {' · '}<span>True North ≈ 4:30 axis</span>
          </p>
        </div>
        <div class="map-actions">
          <button
            type="button"
            class="map-legend-btn"
            aria-label="How to read the BRC map"
            title="How to read the BRC map"
            onClick={() => setInfoOpen(true)}
          >
            <span class="map-legend-q">?</span> Legend
          </button>
          {geo.status === 'idle' && (
            <button type="button" class="primary-btn" onClick={requestGps}>
              Use my GPS
            </button>
          )}
          {geo.status === 'requesting' && (
            <span class="map-gps">Requesting location…</span>
          )}
          {geo.status === 'denied' && (
            <span class="map-gps-err">Location denied. Fix in browser settings to enable navigation.</span>
          )}
          {geo.status === 'error' && (
            <span class="map-gps-err">Location error: {geo.message}</span>
          )}
          {geo.status === 'ready' && (
            <span class="map-gps">
              {userAddress ? (
                <>
                  <strong>You're at {userAddress.clock} &amp; {userAddress.street}</strong>
                  {' '}· ±{Math.round(geo.accuracyM)}m{' '}
                </>
              ) : (
                <>
                  GPS ok · off-grid · ±{Math.round(geo.accuracyM)}m{' '}
                </>
              )}
              <button type="button" class="subtle-btn" onClick={stopGps}>stop</button>
            </span>
          )}
        </div>
      </div>

      {pins.length === 0 && !myCampPin && myMeetPins.length === 0 && friendCampPins.length === 0 && friendMeetPins.length === 0 ? (
        <div class="empty-state">
          No camps or meet spots to plot yet. Star a camp or event (auto-stars
          its camp), mark one as <strong>my camp</strong>, or add a meet spot
          below — any of those will pin here.
        </div>
      ) : (
        <>
          {/* Rendezvous layer — pulled ABOVE the map SVG so the newest
              feature (my-camp + meet spots + friends' plans) is the
              first thing a user sees when they open the Map tab, not
              a buried section below the map. */}
          <div class="map-rendezvous-box">
            <div class="map-rendezvous-head">
              <h4>Meet spots</h4>
              <button
                class="primary-btn map-add-spot"
                type="button"
                onClick={() => setAddingSpot(true)}
              >+ Add</button>
            </div>
            {activeSpot && (
              <div class="map-target-box spot">
                <div class="map-target-name">
                  ◆ {activeSpot.author ? `${activeSpot.author}: ` : ''}{activeSpot.label}
                </div>
                <div class="map-target-addr">
                  {activeSpot.address}
                  {activeSpot.when && <> · <strong>{activeSpot.when}</strong></>}
                </div>
                {spotInfo && (
                  <>
                    <div class="map-target-nav">
                      <strong>{Math.round(spotInfo.meters)} m</strong> away,
                      bearing <strong>{Math.round(spotInfo.bearing)}°</strong>
                      {' '}
                      (compass {compassCardinal(spotInfo.bearing)})
                    </div>
                    <div class="map-target-eta">
                      {(() => {
                        const e = etaMinutes(spotInfo.meters);
                        return <>~{e.walk} min walk · {e.bike} min bike</>;
                      })()}
                    </div>
                  </>
                )}
                <div class="map-target-links">
                  <button
                    type="button" class="subtle-btn"
                    onClick={() => setSelectedSpot(null)}
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
            {myCampPin && (
              <div
                class={'map-my-camp-row' + (target?.camp.id === myCampPin.camp.id ? ' active' : '')}
                onClick={() => { setSelectedSpot(null); setTargetId(myCampPin.camp.id); }}
              >
                <span class="map-my-camp-icon" aria-hidden="true">🏕</span>
                <div>
                  <div class="map-my-camp-name">Your camp — {myCampPin.camp.name}</div>
                  <div class="map-pin-addr">{myCampPin.camp.location}</div>
                </div>
              </div>
            )}
            {meetSpots.length === 0 && !myCampPin && (
              <p class="map-rendezvous-hint">
                Set a camp card as <strong>my camp</strong> in the Camps
                view, or add a spot here. Anything you add rides along
                when you share — friends see it on their map after
                importing.
              </p>
            )}
            {meetSpots.length > 0 && (
              <ul class="map-meet-list">
                {meetSpots.map((spot, idx) => {
                  const active =
                    selectedSpot?.source === 'mine' && selectedSpot.idx === idx;
                  return (
                    <li
                      key={`spot-${idx}`}
                      class={'map-meet-row clickable' + (active ? ' active' : '')}
                      onClick={() => { setTargetId(null); setSelectedSpot({ source: 'mine', idx }); }}
                    >
                      <span class="map-meet-diamond mine" aria-hidden="true">◆</span>
                      <div class="map-meet-body">
                        <div class="map-meet-label">{spot.label}</div>
                        <div class="map-pin-addr">
                          {spot.address}{spot.when ? ` · ${spot.when}` : ''}
                        </div>
                      </div>
                      <button
                        class="meet-delete-btn"
                        type="button"
                        aria-label="Delete this meet spot"
                        title="Delete this meet spot"
                        onClick={(e) => { e.stopPropagation(); onRemoveMeetSpot(idx); }}
                      >
                        <TrashIcon />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {poiPins.length > 0 && (
              <>
                <div class="map-rendezvous-head"><h4>Landmarks</h4></div>
                <ul class="map-meet-list">
                  {poiPins.map(({ poi }) => (
                    <li key={`poi-${poi.kind}-${poi.name}`} class="map-meet-row">
                      <span class={`map-poi-dot map-poi-${poi.kind}`} aria-hidden="true" />
                      <div class="map-meet-body">
                        <div class="map-meet-label">{poi.name}</div>
                        <div class="map-pin-addr">
                          {poi.address}
                          {poi.description && <> · {poi.description}</>}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {friendsRendezvous.some((f) => f.myCampId || (f.meetSpots && f.meetSpots.length > 0)) && (
              <>
                <div class="map-rendezvous-head"><h4>Friends' plans</h4></div>
                <ul class="map-meet-list">
                  {friendCampPins.map((fp) => (
                    <li
                      key={`fc-${fp.name}-${fp.camp.id}`}
                      class={'map-meet-row clickable' + (target?.camp.id === fp.camp.id ? ' active' : '')}
                      onClick={() => { setSelectedSpot(null); setTargetId(fp.camp.id); }}
                    >
                      <span class="map-meet-diamond" aria-hidden="true">🏕</span>
                      <div class="map-meet-body">
                        <div class="map-meet-label">
                          <span class="fav-by-chip" style={friendChipStyle(fp.name)}>{fp.name}</span>
                          {' · camp'}
                        </div>
                        <div class="map-pin-addr">{fp.camp.name} — {fp.camp.location}</div>
                      </div>
                    </li>
                  ))}
                  {friendMeetPins.map((fm) => {
                    const active =
                      selectedSpot?.source === 'friend'
                      && selectedSpot.name === fm.name
                      && selectedSpot.idx === fm.idx;
                    return (
                      <li
                        key={`fm-${fm.name}-${fm.idx}`}
                        class={'map-meet-row clickable' + (active ? ' active' : '')}
                        onClick={() => {
                          setTargetId(null);
                          setSelectedSpot({ source: 'friend', name: fm.name, idx: fm.idx });
                        }}
                      >
                        <span class="map-meet-diamond" aria-hidden="true">◆</span>
                        <div class="map-meet-body">
                          <div class="map-meet-label">
                            <span class="fav-by-chip" style={friendChipStyle(fm.name)}>{fm.name}</span>
                            {' · '}{fm.spot.label}
                          </div>
                          <div class="map-pin-addr">
                            {fm.spot.address}{fm.spot.when ? ` · ${fm.spot.when}` : ''}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>

          <Svg
            pins={pins}
            target={target}
            targetAddress={target ? parseAddress(target.camp.location) : null}
            userSvg={userSvg}
            onSelectPin={(id) => { setSelectedSpot(null); setTargetId(id); }}
            onClearSelection={clearSelection}
            myCampPin={myCampPin}
            myMeetPins={myMeetPins}
            friendCampPins={friendCampPins}
            friendMeetPins={friendMeetPins}
            selectedSpot={selectedSpot}
            setSelectedSpot={(sel) => { setTargetId(null); setSelectedSpot(sel); }}
            activeSpot={activeSpot}
            activeSpotAddress={activeSpot ? parseAddress(activeSpot.address) : null}
            poiPins={poiPins}
          />
          {/* Pin list + navigation details */}
          <div class="map-list">
            <h4>Starred camps</h4>
            {target && (
              <div class="map-target-box">
                <div class="map-target-name">→ {target.camp.name}</div>
                <div class="map-target-addr">{target.camp.location}</div>
                {targetInfo ? (
                  <>
                    <div class="map-target-nav">
                      <strong>{Math.round(targetInfo.meters)} m</strong> away,
                      bearing <strong>{Math.round(targetInfo.bearing)}°</strong>
                      {' '}
                      (compass {compassCardinal(targetInfo.bearing)})
                    </div>
                    <div class="map-target-eta">
                      {(() => {
                        const e = etaMinutes(targetInfo.meters);
                        return <>~{e.walk} min walk · {e.bike} min bike</>;
                      })()}
                    </div>
                  </>
                ) : geo.status === 'ready' ? (
                  <div class="map-target-nav footnote">
                    Couldn't resolve this camp's address to lat/lng.
                  </div>
                ) : (
                  <div class="map-target-nav footnote">
                    Tap "Use my GPS" above to see bearing + distance.
                  </div>
                )}
                {(() => {
                  const starred = (target.camp.events ?? []).filter(
                    (e) => favEventIds.has(e.id) || friendFavEventIds(e.id).length > 0,
                  );
                  if (starred.length === 0) return null;
                  return (
                    <div class="map-target-events">
                      <div class="map-target-events-head">
                        Your starred events at this camp
                      </div>
                      <ul>
                        {starred.map((e) => (
                          <li key={e.id}>
                            <a
                              href={`https://directory.burningman.org/events/${encodeURIComponent(e.id)}/`}
                              target="_blank" rel="noopener"
                            >{e.name}</a>
                            {e.display_time && <span class="map-ev-time"> · {e.display_time}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}
                <div class="map-target-links">
                  <button
                    type="button" class="map-ext-link"
                    onClick={() => onGotoCamp(target.camp.id)}
                  >
                    Open camp card →
                  </button>
                  {externalMapsUrl(target.camp) && (
                    <a
                      class="map-ext-link"
                      href={externalMapsUrl(target.camp)!}
                      target="_blank" rel="noopener"
                    >
                      Open in Google Maps ↗
                    </a>
                  )}
                  <button
                    type="button" class="subtle-btn"
                    onClick={() => { setTargetId(null); onClearTarget?.(); }}
                  >
                    Clear target
                  </button>
                </div>
              </div>
            )}
            <ul>
              {pins.map((p) => (
                <li
                  key={p.camp.id}
                  class={'map-pin-row' + (target?.camp.id === p.camp.id ? ' active' : '')}
                  onClick={() => { setSelectedSpot(null); setTargetId(p.camp.id); }}
                >
                  <span class={'map-pin-dot' + (p.mine ? ' mine' : '')}>★</span>
                  <span class="map-pin-name">{p.camp.name}</span>
                  <span class="map-pin-addr">{p.camp.location}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
      <MapInfoModal open={infoOpen} onClose={() => setInfoOpen(false)} />
      {addingSpot && (
        <MeetSpotEditor
          onSave={(spot) => { onAddMeetSpot(spot); setAddingSpot(false); }}
          onCancel={() => setAddingSpot(false)}
        />
      )}
    </div>
  );
}

function compassCardinal(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const i = Math.round(((deg % 360) + 360) / 45) % 8;
  return dirs[i];
}

// --- SVG --------------------------------------------------------------

function Svg({
  pins, target, targetAddress, userSvg, onSelectPin, onClearSelection,
  myCampPin, myMeetPins, friendCampPins, friendMeetPins,
  selectedSpot, setSelectedSpot, activeSpot, activeSpotAddress,
  poiPins,
}: {
  pins: Array<{ camp: Camp; x: number; y: number; mine: boolean; friends: string[] }>;
  target: { camp: Camp; x: number; y: number } | null;
  /** Parsed address for the selected camp — both the polar numerics
   *  (for drawing the highlighted radial + ring arc) and the display
   *  strings (for the large address readout next to the Man). Null
   *  when no pin is selected or the address doesn't parse. */
  targetAddress: {
    clockHour: number; radiusFeet: number;
    clock: string; street: string;
  } | null;
  userSvg: { x: number; y: number } | null;
  onSelectPin: (id: string) => void;
  /** Click on empty map canvas (not on a pin) drops the selection —
   *  clears the highlighted radial/ring/halo and the address readout. */
  onClearSelection: () => void;
  myCampPin: { camp: Camp; x: number; y: number } | null;
  myMeetPins: Array<{ spot: MeetSpot; idx: number; x: number; y: number }>;
  friendCampPins: Array<{ name: string; camp: Camp; x: number; y: number }>;
  friendMeetPins: Array<{ name: string; spot: MeetSpot; idx: number; x: number; y: number }>;
  selectedSpot:
    | { source: 'mine'; idx: number }
    | { source: 'friend'; name: string; idx: number }
    | null;
  setSelectedSpot: (sel:
    | { source: 'mine'; idx: number }
    | { source: 'friend'; name: string; idx: number }
    | null
  ) => void;
  /** Pre-resolved details for the currently-selected spot: display
   *  label, author (null if yours), x/y in SVG space. */
  activeSpot: {
    label: string; address: string; when?: string;
    x: number; y: number; author: string | null;
  } | null;
  /** parseAddress() output for activeSpot's address — used to draw the
   *  accent radial + ring highlight identical to camp selections. */
  activeSpotAddress: {
    clockHour: number; radiusFeet: number;
    clock: string; street: string;
  } | null;
  /** Points of interest (Center Camp, Playa Info, etc) — static data
   *  from map/data.ts, resolved into SVG space. Rendered as distinct
   *  non-selectable markers beneath the camp + meet pins. */
  poiPins: Array<{ poi: BrcPOI; x: number; y: number }>;
}) {
  const vb = VIEWBOX_RADIUS;
  const top = VIEWBOX_TOP_MARGIN;
  // Radial streets we draw: 2:00 through 10:00. The arc is NOT a full
  // circle — the 6:00 side is open to the playa.
  const radialHours = [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];

  return (
    <svg
      class="brc-svg"
      viewBox={`${-vb} ${-top} ${vb * 2} ${vb + top}`}
      preserveAspectRatio="xMidYMid meet"
      aria-label="Black Rock City map"
      onClick={onClearSelection}
    >
      {/* background — "open playa" fill. Sized generously and clipped
          to viewBox automatically; the top half gets cropped away
          along with the unused empty space. */}
      <circle cx={0} cy={0} r={vb * 0.98} class="brc-playa" />
      {/* Concentric letter streets, 2:00 → 10:00 through 6:00 (the
          city side). Polyline approximation — SVG's A-command flags
          for large-arc/sweep disambiguation render counter-intuitively
          with our y-inverted coord system, so we just iterate hour
          positions. Going through increasing hour from 2 to 10 traces
          3→4→…→9, which is the BRC-occupied arc. */}
      {BRC.streetRadiiFeet.map((r, idx) => (
        <path
          key={idx}
          d={arcPolylinePath(2, 10, r)}
          class={'brc-street' + (idx === 0 ? ' esplanade' : '')}
          fill="none"
        />
      ))}
      {/* radial streets: line from Esplanade (inner) out to K (outer) */}
      {radialHours.map((h) => {
        const inner = hourToSvgPoint(h, BRC.streetRadiiFeet[0]);
        const outer = hourToSvgPoint(h, BRC.streetRadiiFeet[BRC.streetRadiiFeet.length - 1]);
        return (
          <line
            key={h}
            x1={inner.x} y1={inner.y}
            x2={outer.x} y2={outer.y}
            class="brc-street radial"
          />
        );
      })}
      {/* 6:00 Promenade (Center Camp axis) — decorative line from the
          Man out to Esplanade. Marks the ceremonial entry axis. The
          opposing 12:00 axis (deep playa) used to be drawn here too,
          but we cropped the top of the viewBox, so it's gone. */}
      <line x1={0} y1={0} x2={hourToSvgPoint(6, BRC.streetRadiiFeet[0]).x} y2={hourToSvgPoint(6, BRC.streetRadiiFeet[0]).y} class="brc-street axis" />
      {/* The Man */}
      <circle cx={0} cy={0} r={90} class="brc-man" />
      <text x={0} y={-150} class="brc-label man-label" text-anchor="middle">The Man</text>
      {/* Prominent address readout near the Man when a pin is selected
          — gives an unmissable "this is what 7:30 & E looks like"
          signal so the user can correlate the highlight to the address.
          Positioned above the Man label so it doesn't collide with the
          6:00 axis line running downward. Also handles meet spots —
          whichever of {camp, spot} is the active selection renders. */}
      {target && targetAddress && (
        <text
          x={0} y={-460}
          class="brc-label brc-address-label"
          text-anchor="middle"
        >
          {targetAddress.clock} &amp; {targetAddress.street}
        </text>
      )}
      {!target && activeSpot && activeSpotAddress && (
        <>
          <text
            x={0} y={-620}
            class="brc-label brc-address-title"
            text-anchor="middle"
          >
            {activeSpot.author ? `${activeSpot.author}: ${activeSpot.label}` : activeSpot.label}
          </text>
          <text
            x={0} y={-460}
            class="brc-label brc-address-label"
            text-anchor="middle"
          >
            {activeSpotAddress.clock} &amp; {activeSpotAddress.street}
          </text>
        </>
      )}
      {/* Street letter labels — clock-hour 10:00, nudged just past each
          arc's termination so the letter sits right at the line. The
          Esplanade label is the full word (not a single glyph), so it
          needs more radial breathing room than A–K to keep the text
          from crowding its own arc. */}
      {BRC.streetLetters.map((letter, idx) => {
        const offset = idx === 0 ? 240 : 50;
        const r = BRC.streetRadiiFeet[idx] + offset;
        const p = hourToSvgPoint(10, r);
        return (
          <text
            key={letter}
            x={p.x} y={p.y}
            class="brc-label street-label"
            text-anchor="middle"
          >{letter}</text>
        );
      })}
      {/* Clock hour labels at the outer ring */}
      {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((h) => {
        const p = hourToSvgPoint(h, BRC.streetRadiiFeet[BRC.streetRadiiFeet.length - 1] + 350);
        return (
          <text key={h} x={p.x} y={p.y} class="brc-label hour-label" text-anchor="middle">
            {h}:00
          </text>
        );
      })}

      {/* Spot highlight — same radial + ring-arc + halo treatment as
          camp highlights, but recolored via `.brc-highlight.spot`
          CSS so the violet meet-spot palette reads instead of orange. */}
      {!target && activeSpot && activeSpotAddress && (() => {
        const outerR = BRC.streetRadiiFeet[BRC.streetRadiiFeet.length - 1] + 150;
        const radialEnd = hourToSvgPoint(activeSpotAddress.clockHour, outerR);
        const span = 0.6;
        const arcD = arcPolylinePath(
          activeSpotAddress.clockHour - span,
          activeSpotAddress.clockHour + span,
          activeSpotAddress.radiusFeet,
          12,
        );
        return (
          <g class="brc-highlight spot">
            <line x1={0} y1={0} x2={radialEnd.x} y2={radialEnd.y} class="brc-highlight-radial" />
            <path d={arcD} class="brc-highlight-ring" fill="none" />
            <circle cx={activeSpot.x} cy={activeSpot.y} r={180} class="brc-highlight-halo" />
          </g>
        );
      })()}

      {/* Address highlight — draws the selected camp's clock radial +
          a small ring-arc around it so the user can visually trace the
          (clock, letter) grid coordinate that its address maps to. */}
      {target && targetAddress && (() => {
        const outerR = BRC.streetRadiiFeet[BRC.streetRadiiFeet.length - 1] + 150;
        const radialEnd = hourToSvgPoint(targetAddress.clockHour, outerR);
        // Arc segment: ±0.6 clock-hours around the camp's hour, at the
        // camp's radius. Narrow enough to point, wide enough to notice.
        const span = 0.6;
        const arcD = arcPolylinePath(
          targetAddress.clockHour - span,
          targetAddress.clockHour + span,
          targetAddress.radiusFeet,
          12,
        );
        return (
          <g class="brc-highlight">
            <line x1={0} y1={0} x2={radialEnd.x} y2={radialEnd.y} class="brc-highlight-radial" />
            <path d={arcD} class="brc-highlight-ring" fill="none" />
            <circle cx={target.x} cy={target.y} r={180} class="brc-highlight-halo" />
          </g>
        );
      })()}

      {/* Bearing line from user to target */}
      {userSvg && target && (
        <line
          x1={userSvg.x} y1={userSvg.y}
          x2={target.x} y2={target.y}
          class="brc-bearing"
        />
      )}

      {/* Static POIs — landmarks like Center Camp + Playa Info. Sized
          larger than the starred-camp pins so these "everyone's
          reference points" read as anchors of the map. Drawn before
          the user-authored pins so a starred camp at the same spot
          wouldn't be covered over. */}
      {poiPins.map(({ poi, x, y }) => (
        <g
          key={`poi-${poi.kind}-${poi.name}`}
          class={`brc-poi brc-poi-${poi.kind}`}
          transform={`translate(${x} ${y})`}
        >
          <circle r={120} class="brc-poi-halo" />
          <circle r={60} class="brc-poi-dot" />
          <title>{poi.name}{poi.description ? ` — ${poi.description}` : ''}</title>
        </g>
      ))}

      {/* Pins */}
      {pins.map((p) => (
        <g
          key={p.camp.id}
          class={'brc-pin' + (target?.camp.id === p.camp.id ? ' active' : '') + (p.mine ? ' mine' : ' friend')}
          transform={`translate(${p.x} ${p.y})`}
          onClick={(e) => {
            // Stop the click from bubbling to the SVG's clear handler,
            // so picking a pin doesn't immediately deselect it.
            e.stopPropagation();
            onSelectPin(p.camp.id);
          }}
        >
          <circle r={70} class="brc-pin-outer" />
          <circle r={35} class="brc-pin-inner" />
          <title>{p.camp.name}{p.camp.location ? ` — ${p.camp.location}` : ''}</title>
        </g>
      ))}

      {/* Your home camp — a big teal tent. Deliberately sized larger
          than every other pin so it anchors the map: "this is where I
          sleep" should be the most visible thing at a glance. Color
          (teal, --my-camp) contrasts with the star-gold + accent-
          orange used elsewhere. */}
      {myCampPin && (
        <g
          class="brc-my-camp"
          transform={`translate(${myCampPin.x} ${myCampPin.y})`}
          onClick={(e) => { e.stopPropagation(); onSelectPin(myCampPin.camp.id); }}
        >
          <circle r={140} class="brc-my-camp-halo" />
          {/* Tent triangle ~150 viewBox units wide, 125 tall.
              Roughly 2x the camp-pin circle footprint. */}
          <path d="M -75 55 L 0 -70 L 75 55 Z" class="brc-my-camp-body" />
          <title>Your home camp — {myCampPin.camp.name}</title>
        </g>
      )}
      {/* Friends' home camps — tent shape in each friend's hue. */}
      {friendCampPins.map((fp) => (
        <g
          key={`friend-camp-${fp.name}-${fp.camp.id}`}
          class="brc-friend-camp"
          transform={`translate(${fp.x} ${fp.y})`}
          onClick={(e) => { e.stopPropagation(); onSelectPin(fp.camp.id); }}
          style={friendHueStyle(fp.name)}
        >
          <circle r={80} class="brc-friend-camp-halo" />
          <path d="M -45 32 L 0 -40 L 45 32 Z" class="brc-friend-camp-body" />
          <title>{fp.name}'s camp — {fp.camp.name}</title>
        </g>
      ))}
      {/* Your meet spots — violet diamond pins, distinct from the
          accent-orange camp pins. Bigger than camp pins too so they
          visually assert "rendezvous plans" vs "places I might visit".
          Clickable — selecting a spot displays its details near the
          Man using the same address-readout slot as camp selections. */}
      {myMeetPins.map((mp) => {
        const active =
          selectedSpot?.source === 'mine' && selectedSpot.idx === mp.idx;
        return (
          <g
            key={`my-spot-${mp.idx}`}
            class={'brc-meet' + (active ? ' active' : '')}
            transform={`translate(${mp.x} ${mp.y}) rotate(45)`}
            onClick={(e) => {
              e.stopPropagation();
              // The caller's setSelectedSpot already clears any camp
              // target on the parent side; we just relay the selection.
              setSelectedSpot({ source: 'mine', idx: mp.idx });
            }}
          >
            <rect x={-50} y={-50} width={100} height={100} class="brc-meet-body" />
            <title>{mp.spot.label} — {mp.spot.address}{mp.spot.when ? ` · ${mp.spot.when}` : ''}</title>
          </g>
        );
      })}
      {/* Friends' meet spots — same diamond shape, tinted with friend
          hue so Alice's plans read differently from Bob's. */}
      {friendMeetPins.map((fm) => {
        const active =
          selectedSpot?.source === 'friend'
          && selectedSpot.name === fm.name
          && selectedSpot.idx === fm.idx;
        return (
          <g
            key={`fr-spot-${fm.name}-${fm.idx}`}
            class={'brc-meet friend' + (active ? ' active' : '')}
            transform={`translate(${fm.x} ${fm.y}) rotate(45)`}
            style={friendHueStyle(fm.name)}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedSpot({ source: 'friend', name: fm.name, idx: fm.idx });
            }}
          >
            <rect x={-42} y={-42} width={84} height={84} class="brc-meet-body" />
            <title>{fm.name}: {fm.spot.label} — {fm.spot.address}{fm.spot.when ? ` · ${fm.spot.when}` : ''}</title>
          </g>
        );
      })}

      {/* You are here */}
      {userSvg && (
        <g transform={`translate(${userSvg.x} ${userSvg.y})`} class="brc-user">
          <circle r={100} class="brc-user-halo" />
          <circle r={40} class="brc-user-dot" />
          <title>You are here</title>
        </g>
      )}
    </svg>
  );
}

/** Convert a BRC clock-hour + radius to SVG coordinates. 12:00 points up. */
function hourToSvgPoint(hour: number, radius: number): { x: number; y: number } {
  const theta = (hour / 12) * 2 * Math.PI;
  return { x: radius * Math.sin(theta), y: -radius * Math.cos(theta) };
}

/** CSS custom-property style for a friend's per-name hue — lets the
 *  brc-friend-camp / brc-meet.friend classes pick up the same color
 *  the chips use without duplicating the hash in CSS. */
function friendHueStyle(name: string): Record<string, string> {
  const bg = friendChipStyle(name).background;  // "hsla(H, 65%, 50%, 0.20)"
  const match = /hsla\((\d+(?:\.\d+)?)/.exec(bg);
  const hue = match ? match[1] : '20';
  return { '--friend-hue': hue } as Record<string, string>;
}

/** Polyline approximation of an arc at `radius` between two clock
 *  hours, sampled at `steps` evenly-spaced hours. Monotonic in the
 *  hour parameter, so the path runs through every intermediate hour —
 *  going 2 → 10 sweeps through 3…9 (bottom of the map, where the BRC
 *  city sits), not through 12 (open playa). Avoids the SVG A-command
 *  flag ambiguity which rendered the wrong arc with y-down coords. */
function arcPolylinePath(
  startHour: number, endHour: number, radius: number, steps = 48,
): string {
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const h = startHour + (endHour - startHour) * (i / steps);
    const p = hourToSvgPoint(h, radius);
    pts.push(`${p.x} ${p.y}`);
  }
  return 'M ' + pts.join(' L ');
}
