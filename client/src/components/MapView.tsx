// Static SVG renderer of Black Rock City. No external tiles, no
// network — works offline once the site has loaded. Plots starred camps
// as pins and, if the user grants GPS, shows a "you are here" dot plus
// a bearing line to the selected target.
//
// Coordinates:
//   - SVG viewBox spans ±6000 ft centered on the Man
//   - 12:00 points up. Clockwise as you'd read a real clock.
//   - Lat/lng → ft via haversine + compass rotation (see utils/address).
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
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
import { TentIcon } from './TentIcon';

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
/** Default viewBox geometry (pre-zoom). Width/height derived from
 *  VIEWBOX_RADIUS + VIEWBOX_TOP_MARGIN; center is the midpoint of that
 *  box, which sits 1350 ft south of the Man because the view is
 *  asymmetrically cropped (more room below for the city). */
const DEFAULT_VB_WIDTH = VIEWBOX_RADIUS * 2;
const DEFAULT_VB_HEIGHT = VIEWBOX_RADIUS + VIEWBOX_TOP_MARGIN;
const DEFAULT_CENTER = { x: 0, y: (DEFAULT_VB_HEIGHT / 2) - VIEWBOX_TOP_MARGIN };
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.5;

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
  // Zoom state. `zoom` multiplies the rendered scale (1 = fit whole city,
  // ~4 = close-up). `center` is the (x, y) in SVG feet the viewBox is
  // centered on — moves when the user selects a pin/spot while zoomed in
  // so the selection stays in frame.
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const zoomIn = useCallback(
    () => setZoom((z) => Math.min(ZOOM_MAX, z * ZOOM_STEP)),
    [],
  );
  const zoomOut = useCallback(
    () => setZoom((z) => {
      const next = Math.max(ZOOM_MIN, z / ZOOM_STEP);
      // Re-anchor to the full-city view once we're back to 1x so the
      // user doesn't land on an off-center frame.
      if (next === ZOOM_MIN) setCenter(DEFAULT_CENTER);
      return next;
    }),
    [],
  );
  const resetZoom = useCallback(
    () => { setZoom(1); setCenter(DEFAULT_CENTER); },
    [],
  );
  // Selected meet spot (mine or a friend's). Mutually exclusive with
  // `targetId` (the camp-selection path). Whichever the user last
  // clicked is the one whose details show near the Man.
  const [selectedSpot, setSelectedSpot] = useState<
    | { source: 'mine'; idx: number }
    | { source: 'friend'; name: string; idx: number }
    | { source: 'poi'; kind: string; name: string }
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
        description: undefined as string | undefined,
        x: m.x, y: m.y, author: null as string | null, isPoi: false,
      };
    }
    if (selectedSpot.source === 'friend') {
      const f = friendMeetPins.find(
        (p) => p.name === selectedSpot.name && p.idx === selectedSpot.idx,
      );
      if (!f) return null;
      return {
        label: f.spot.label, address: f.spot.address, when: f.spot.when,
        description: undefined as string | undefined,
        x: f.x, y: f.y, author: f.name, isPoi: false,
      };
    }
    // POI — look up by kind + name so we pull the fresh address + desc.
    const hit = poiPins.find(
      ({ poi }) => poi.kind === selectedSpot.kind && poi.name === selectedSpot.name,
    );
    if (!hit) return null;
    return {
      label: hit.poi.name, address: hit.poi.address, when: undefined,
      description: hit.poi.description,
      x: hit.x, y: hit.y, author: null as string | null, isPoi: true,
    };
  }, [selectedSpot, myMeetPins, friendMeetPins, poiPins]);

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

  // Target resolution. Falls through three sources in priority order —
  // starred pins, my home camp, friends' home camps — so selecting any
  // tent on the map (not just starred dots) shows the camp details.
  // `author` and `kind` drive the "Your camp — X" / "Alice's camp: X"
  // prefix on the big label near the Man.
  const target = useMemo((): {
    camp: Camp; x: number; y: number;
    author: string | null;
    kind: 'fav' | 'mine' | 'friend';
  } | null => {
    if (!targetId) return null;
    const p = pins.find((x) => x.camp.id === targetId);
    if (p) return { camp: p.camp, x: p.x, y: p.y, author: null, kind: 'fav' };
    if (myCampPin && myCampPin.camp.id === targetId) {
      return { camp: myCampPin.camp, x: myCampPin.x, y: myCampPin.y, author: null, kind: 'mine' };
    }
    const f = friendCampPins.find((fp) => fp.camp.id === targetId);
    if (f) return { camp: f.camp, x: f.x, y: f.y, author: f.name, kind: 'friend' };
    return null;
  }, [targetId, pins, myCampPin, friendCampPins]);

  // When the user picks a pin / spot / POI while zoomed in, pan the
  // viewBox over so the selection is visible. At 1x the whole city is
  // already visible so there's nothing to pan toward.
  useEffect(() => {
    if (zoom <= 1) return;
    if (target) setCenter({ x: target.x, y: target.y });
    else if (activeSpot) setCenter({ x: activeSpot.x, y: activeSpot.y });
  }, [target, activeSpot, zoom]);

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
          <div class="map-zoom-ctl" role="group" aria-label="Map zoom">
            <button
              type="button"
              class="map-zoom-btn"
              aria-label="Zoom out"
              title="Zoom out"
              onClick={zoomOut}
              disabled={zoom <= ZOOM_MIN}
            >−</button>
            <span class="map-zoom-level" aria-live="polite">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              class="map-zoom-btn"
              aria-label="Zoom in"
              title="Zoom in"
              onClick={zoomIn}
              disabled={zoom >= ZOOM_MAX}
            >+</button>
            {zoom > 1 && (
              <button
                type="button"
                class="map-zoom-reset"
                aria-label="Reset zoom"
                title="Reset zoom"
                onClick={resetZoom}
              >⤾</button>
            )}
          </div>
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
              <div class={'map-target-box spot' + (activeSpot.isPoi ? ' poi' : '')}>
                <div class="map-target-name">
                  {activeSpot.isPoi ? '📍' : '◆'}{' '}
                  {activeSpot.author ? `${activeSpot.author}: ` : ''}{activeSpot.label}
                </div>
                <div class="map-target-addr">
                  {activeSpot.address}
                  {activeSpot.when && <> · <strong>{activeSpot.when}</strong></>}
                </div>
                {activeSpot.description && (
                  <div class="map-target-desc">{activeSpot.description}</div>
                )}
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
                <span class="map-my-camp-icon" aria-hidden="true"><TentIcon size={18} /></span>
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
                  {poiPins.map(({ poi }) => {
                    const active =
                      selectedSpot?.source === 'poi'
                      && selectedSpot.kind === poi.kind
                      && selectedSpot.name === poi.name;
                    return (
                      <li
                        key={`poi-${poi.kind}-${poi.name}`}
                        class={'map-meet-row clickable' + (active ? ' active' : '')}
                        onClick={() => {
                          setTargetId(null);
                          setSelectedSpot({ source: 'poi', kind: poi.kind, name: poi.name });
                        }}
                      >
                        <span class={`map-poi-dot map-poi-${poi.kind}`} aria-hidden="true" />
                        <div class="map-meet-body">
                          <div class="map-meet-label">{poi.name}</div>
                          <div class="map-pin-addr">
                            {poi.address}
                            {poi.description && <> · {poi.description}</>}
                          </div>
                        </div>
                      </li>
                    );
                  })}
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
                      <span class="map-meet-diamond friend-tent" aria-hidden="true" style={friendChipStyle(fp.name)}><TentIcon size={16} /></span>
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

          {/* Pin list + navigation details. Placed ABOVE the map SVG
              so the "tap a row → see it on the map below" flow reads
              top-to-bottom: pick a camp in the list, scroll (or glance)
              down to the SVG to see its location + bearing. */}
          <div class="map-list">
            <h4>Starred camps</h4>
            {target && (
              <div class="map-target-box">
                <div class="map-target-name">
                  →{' '}
                  {target.kind === 'mine' ? <>Your camp — <strong>{target.camp.name}</strong></>
                    : target.kind === 'friend' ? <>{target.author}'s camp — <strong>{target.camp.name}</strong></>
                    : target.camp.name}
                </div>
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
            zoom={zoom}
            center={center}
            setCenter={setCenter}
          />
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
  poiPins, zoom, center, setCenter,
}: {
  pins: Array<{ camp: Camp; x: number; y: number; mine: boolean; friends: string[] }>;
  target: {
    camp: Camp; x: number; y: number;
    author: string | null;
    kind: 'fav' | 'mine' | 'friend';
  } | null;
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
    | { source: 'poi'; kind: string; name: string }
    | null;
  setSelectedSpot: (sel:
    | { source: 'mine'; idx: number }
    | { source: 'friend'; name: string; idx: number }
    | { source: 'poi'; kind: string; name: string }
    | null
  ) => void;
  /** Pre-resolved details for the currently-selected spot: display
   *  label, author (null if yours), x/y in SVG space. POIs carry a
   *  description instead of a `when`, and `isPoi` flips the styling. */
  activeSpot: {
    label: string; address: string; when?: string;
    description?: string;
    x: number; y: number; author: string | null;
    isPoi: boolean;
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
  /** Zoom multiplier (1 = fit whole city). Width/height of the viewBox
   *  scale inversely with this. */
  zoom: number;
  /** SVG-space point the viewBox is centered on — moves on selection
   *  when zoom > 1 so the picked pin stays in frame. */
  center: { x: number; y: number };
  /** Setter for pan — wired to pointer drag events below. */
  setCenter: (c: { x: number; y: number }) => void;
}) {
  // Radial streets we draw: 2:00 through 10:00. The arc is NOT a full
  // circle — the 6:00 side is open to the playa.
  const radialHours = [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
  // viewBox derived from zoom + center. At zoom=1 this reproduces the
  // original `-6000 -3300 12000 9300` frame exactly (DEFAULT_CENTER is
  // the midpoint of that frame).
  const vbW = DEFAULT_VB_WIDTH / zoom;
  const vbH = DEFAULT_VB_HEIGHT / zoom;
  const vbX = center.x - vbW / 2;
  const vbY = center.y - vbH / 2;

  // Pan via pointer events. Single path handles mouse + touch + pen via
  // the Pointer Events API. `drag` holds the drag-start anchor (pointer
  // screen position + viewBox center at press) so each move computes an
  // absolute delta — avoids jitter from accumulated per-move math.
  //
  // We DELAY calling setPointerCapture until the pointer crosses a real
  // movement threshold. Capturing on pointerdown rewires subsequent
  // `click` events to the SVG (the capture target) rather than to the
  // actual child pin that was tapped — which silently breaks all pin
  // selection while zoomed. Only claim the pointer once we know the
  // user is dragging, not tapping.
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<null | {
    pointerId: number;
    startClientX: number; startClientY: number;
    startCenterX: number; startCenterY: number;
    captured: boolean;
  }>(null);
  const didMove = useRef(false);
  // Movement threshold in screen pixels. Below this, treat the gesture
  // as a tap (click propagates to whatever child was hit). Above it,
  // claim pointer capture + start panning.
  const PAN_THRESHOLD_PX = 6;

  const onPointerDown = (e: PointerEvent) => {
    if (zoom <= 1) return; // nothing to pan to at 1x — whole city is shown
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX, startClientY: e.clientY,
      startCenterX: center.x, startCenterY: center.y,
      captured: false,
    };
    didMove.current = false;
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId || !svgRef.current) return;
    const pxDelta = Math.abs(e.clientX - d.startClientX)
      + Math.abs(e.clientY - d.startClientY);
    if (!d.captured) {
      if (pxDelta < PAN_THRESHOLD_PX) return; // still within tap slop
      svgRef.current.setPointerCapture(e.pointerId);
      d.captured = true;
      didMove.current = true;
    }
    // Convert pixel delta → SVG units. Same scale factor both axes
    // because preserveAspectRatio is xMidYMid meet (uniform scaling).
    const rect = svgRef.current.getBoundingClientRect();
    const scale = vbW / rect.width;
    const dx = (e.clientX - d.startClientX) * scale;
    const dy = (e.clientY - d.startClientY) * scale;
    // Drag right → center moves left so content follows the finger.
    setCenter({ x: d.startCenterX - dx, y: d.startCenterY - dy });
  };
  const onPointerEnd = (e: PointerEvent) => {
    const d = drag.current;
    if (d && d.pointerId === e.pointerId) {
      if (d.captured) svgRef.current?.releasePointerCapture(e.pointerId);
      drag.current = null;
    }
  };
  const onSvgClick = () => {
    if (didMove.current) { didMove.current = false; return; }
    onClearSelection();
  };

  return (
    <svg
      ref={svgRef}
      class={'brc-svg' + (zoom > 1 ? ' pannable' : '')}
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
      aria-label="Black Rock City map"
      onClick={onSvgClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      {/* background — "open playa" fill. Sized generously and clipped
          to viewBox automatically; the top half gets cropped away
          along with the unused empty space. */}
      <circle cx={0} cy={0} r={VIEWBOX_RADIUS * 0.98} class="brc-playa" />
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
        <>
          {/* Camp name above the big address — mirrors the meet-spot /
              POI layout so all selections read the same. Prefixes the
              name with a possessive when it's a home camp ("Your
              camp — X" / "Alice's camp — X"). */}
          <text
            x={0} y={-920}
            class="brc-label brc-address-title"
            text-anchor="middle"
          >
            {target.kind === 'mine' ? `Your camp — ${target.camp.name}`
              : target.kind === 'friend' ? `${target.author}'s camp — ${target.camp.name}`
              : target.camp.name}
          </text>
          <text
            x={0} y={-460}
            class="brc-label brc-address-label"
            text-anchor="middle"
          >
            {targetAddress.clock} &amp; {targetAddress.street}
          </text>
        </>
      )}
      {!target && activeSpot && activeSpotAddress && (
        <>
          {/* Title sits well above the address so the big 340px address
              letters + smaller 200px title don't collide. The previous
              y=-620 / y=-460 pair left only ~160 of vertical room, less
              than the address ascender itself. */}
          <text
            x={0} y={-920}
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
      {poiPins.map(({ poi, x, y }) => {
        const active =
          selectedSpot?.source === 'poi'
          && selectedSpot.kind === poi.kind
          && selectedSpot.name === poi.name;
        return (
          <g
            key={`poi-${poi.kind}-${poi.name}`}
            class={`brc-poi brc-poi-${poi.kind}` + (active ? ' active' : '')}
            transform={`translate(${x} ${y})`}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedSpot({ source: 'poi', kind: poi.kind, name: poi.name });
            }}
          >
            {/* Transparent hit-catcher (same r=150 pattern as camp pins).
                The visible halo is r=120 which is borderline tappable on
                a phone; 150 keeps us safely above finger-target minima. */}
            <circle r={150} class="brc-pin-hit" />
            <circle r={120} class="brc-poi-halo" />
            <circle r={60} class="brc-poi-dot" />
            <title>{poi.name}{poi.description ? ` — ${poi.description}` : ''}</title>
          </g>
        );
      })}

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
          {/* Invisible hit-catcher. The visible pin is tiny (r=35 dot,
              r=70 halo) which is fine on desktop but below the ~44px
              fat-finger minimum on a phone — Firefox Mobile was
              swallowing taps before they reached the <g>. r=150 matches
              the POI + my-camp footprint so all pins tap the same. */}
          <circle r={150} class="brc-pin-hit" />
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
          class={'brc-my-camp' + (target?.camp.id === myCampPin.camp.id ? ' active' : '')}
          transform={`translate(${myCampPin.x} ${myCampPin.y})`}
          onClick={(e) => { e.stopPropagation(); onSelectPin(myCampPin.camp.id); }}
        >
          {/* Transparent hit-catcher — the halo (r=140) + tent body
              (~75px wide) map to only ~4px on a phone, below fat-finger
              minima. Same pattern as camp pins + POIs. */}
          <circle r={180} class="brc-pin-hit" />
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
          class={'brc-friend-camp' + (target?.camp.id === fp.camp.id ? ' active' : '')}
          transform={`translate(${fp.x} ${fp.y})`}
          onClick={(e) => { e.stopPropagation(); onSelectPin(fp.camp.id); }}
          style={friendHueStyle(fp.name)}
        >
          <circle r={150} class="brc-pin-hit" />
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
