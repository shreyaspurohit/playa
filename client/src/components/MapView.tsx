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
import type { JSX } from 'preact';
import type { Camp, MeetSpot } from '../types';
import type { BrcPOI } from '../map/data';
import { BRC, POIS } from '../map/data';
import {
  addressToSvgFeet, addressToLatLng, bearingDeg, haversineMeters,
  latLngToSvgFeet, latLngToAddress, parseAddress,
} from '../map/address';
import { useGeolocation } from '../hooks/useGeolocation';
import { friendChipStyle, friendHue } from '../utils/friendColor';
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

// === Selection-key encoding ============================================
// Each map item that can be selected gets a stable string key so a
// single Set<string> can track multi-select across heterogeneous
// types (camps, POIs, meet spots). Format documented inline in the
// state declaration. These are module-level pure functions so the
// `useState` initializer can use them.
const campKey = (id: string) => 'camp:' + id;
const mineSpotKey = (idx: number) => 'mine:' + idx;
const friendSpotKey = (name: string, idx: number) =>
  'friend:' + name + ':' + idx;
const poiKey = (kind: string, name: string) => 'poi:' + kind + ':' + name;

export function MapView({
  camps, favCampIds, friendFavCampIds,
  favEventIds, friendFavEventIds,
  myCampId, meetSpots, onAddMeetSpot, onRemoveMeetSpot,
  friendsRendezvous,
  initialTargetId = null, onClearTarget, onGotoCamp,
}: Props) {
  // Unified multi-selection. Each entry is a typed key so a single Set
  // can hold camps, POIs, meet spots, friend camps, friend meet spots
  // concurrently. Tap-to-toggle: every tap on a pin or sidebar row
  // adds the key, or removes it if already present. Tap on the empty
  // SVG canvas clears the whole set.
  //   camp:<id>          — any camp pin (starred, my-camp, friend's)
  //   mine:<idx>         — your meet spot at that index
  //   friend:<name>:<idx>— friend's meet spot at that index
  //   poi:<kind>:<name>  — point of interest
  const [selection, setSelection] = useState<Set<string>>(() =>
    initialTargetId ? new Set([campKey(initialTargetId)]) : new Set(),
  );
  useEffect(() => {
    // External "navigate to camp X" snaps selection to that camp only.
    setSelection(
      initialTargetId ? new Set([campKey(initialTargetId)]) : new Set(),
    );
  }, [initialTargetId]);
  const toggleKey = useCallback((key: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Sidebar list collapse state. Default-collapsed so the map sits
  // close to the top — long lists (30+ camps) used to push the SVG
  // way below the fold. When a section is collapsed we still render
  // any items in it that are SELECTED (so multi-select detail is
  // never hidden), just not the rest of the list. Section keys:
  // 'meet', 'landmarks', 'friends', 'starred'.
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const toggleSection = useCallback((id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const isSectionExpanded = (id: string) => expandedSections.has(id);

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
  // (Selection state lives above as `selection`. `target` and
  // `activeSpot` are derived single-selection views below for code
  // paths that pre-date multi-select — they're populated only when
  // exactly one item is selected.)

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

  // Single-spot view — populated only when exactly one non-camp item
  // is selected. Drives the legacy single-selection sidebar/SVG paths
  // (big near-Man label, GPS bearing line) which only make sense
  // when there's exactly one thing to be "at."
  const activeSpot = useMemo(() => {
    if (selection.size !== 1) return null;
    const key = [...selection][0];
    if (key.startsWith('mine:')) {
      const idx = parseInt(key.slice('mine:'.length), 10);
      const m = myMeetPins.find((p) => p.idx === idx);
      if (!m) return null;
      return {
        label: m.spot.label, address: m.spot.address, when: m.spot.when,
        description: undefined as string | undefined,
        x: m.x, y: m.y, author: null as string | null, isPoi: false,
        color: 'var(--meet)',
      };
    }
    if (key.startsWith('friend:')) {
      const rest = key.slice('friend:'.length);
      const lastColon = rest.lastIndexOf(':');
      const name = rest.slice(0, lastColon);
      const idx = parseInt(rest.slice(lastColon + 1), 10);
      const f = friendMeetPins.find((p) => p.name === name && p.idx === idx);
      if (!f) return null;
      return {
        label: f.spot.label, address: f.spot.address, when: f.spot.when,
        description: undefined as string | undefined,
        x: f.x, y: f.y, author: f.name, isPoi: false,
        color: `hsl(${friendHue(f.name)}, 65%, 50%)`,
      };
    }
    if (key.startsWith('poi:')) {
      const rest = key.slice('poi:'.length);
      const sep = rest.indexOf(':');
      const kind = rest.slice(0, sep);
      const name = rest.slice(sep + 1);
      const hit = poiPins.find(
        ({ poi }) => poi.kind === kind && poi.name === name,
      );
      if (!hit) return null;
      let color = 'var(--muted)';
      if (kind === 'center-camp') color = '#dc2626';
      else if (kind === 'playa-info') color = '#0369a1';
      return {
        label: hit.poi.name, address: hit.poi.address, when: undefined,
        description: hit.poi.description,
        x: hit.x, y: hit.y, author: null as string | null, isPoi: true,
        color,
      };
    }
    return null;
  }, [selection, myMeetPins, friendMeetPins, poiPins]);

  // Unified "clear any selection" — the SVG backdrop + Clear buttons
  // both empty the multi-selection set.
  function clearSelection() {
    setSelection(new Set());
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
    /** Names of friends who starred this camp (for kind='fav'). Empty
     *  for 'mine' / 'friend' kinds — those have a single 'author'. */
    friends: string[];
    /** Highlight color matching the dot's fill. */
    color: string;
  } | null => {
    // Single-select view of the multi-selection set. Returns null
    // when zero or 2+ items are selected — multi-select rendering
    // walks `selectedItems` instead of this memo.
    if (selection.size !== 1) return null;
    const key = [...selection][0];
    if (!key.startsWith('camp:')) return null;
    const targetId = key.slice('camp:'.length);
    const p = pins.find((x) => x.camp.id === targetId);
    if (p) {
      // Gold when you starred it, accent when only friends did.
      const color = p.mine ? '#f59e0b' : 'var(--accent)';
      return {
        camp: p.camp, x: p.x, y: p.y,
        author: null, kind: 'fav', friends: p.friends, color,
      };
    }
    if (myCampPin && myCampPin.camp.id === targetId) {
      return {
        camp: myCampPin.camp, x: myCampPin.x, y: myCampPin.y,
        author: null, kind: 'mine', friends: [],
        color: 'var(--my-camp)',
      };
    }
    const f = friendCampPins.find((fp) => fp.camp.id === targetId);
    if (f) {
      return {
        camp: f.camp, x: f.x, y: f.y,
        author: f.name, kind: 'friend', friends: [],
        color: `hsl(${friendHue(f.name)}, 65%, 50%)`,
      };
    }
    return null;
  }, [selection, pins, myCampPin, friendCampPins]);

  // Multi-select rendering source. Each entry carries everything the
  // SVG layer needs to draw a highlight + line label without re-doing
  // the per-item lookups. Walked once per render — single-select paths
  // (target / activeSpot above) keep their existing structure for
  // backward-compat with the sidebar info boxes.
  const selectedItems = useMemo((): Array<{
    key: string;
    x: number; y: number;
    address: string;             // raw "7:30 & E"
    label: string;               // primary display name
    kind: 'camp' | 'mine' | 'friend' | 'poi';
    /** Hex / hsl / CSS-var string the highlight (radial + ring + halo
     *  + bearing) should use. Matches the dot's actual fill so the
     *  line color reads as continuation of the dot, not a separate
     *  visual layer. */
    color: string;
  }> => {
    const out: Array<{
      key: string; x: number; y: number;
      address: string; label: string;
      kind: 'camp' | 'mine' | 'friend' | 'poi';
      color: string;
    }> = [];
    for (const key of selection) {
      if (key.startsWith('camp:')) {
        const id = key.slice('camp:'.length);
        const p = pins.find((x) => x.camp.id === id)
          || (myCampPin && myCampPin.camp.id === id ? myCampPin : null)
          || friendCampPins.find((fp) => fp.camp.id === id) || null;
        if (!p) continue;
        const camp = (p as { camp: Camp }).camp;
        const author = (p as { name?: string }).name;
        // Color follows the dot itself:
        //   my home camp → teal
        //   friend's home camp → that friend's hue
        //   you starred it → gold (matches `.brc-pin-inner`)
        //   only friends starred it → accent
        let color: string;
        if (myCampPin && myCampPin.camp.id === id) {
          color = 'var(--my-camp)';
        } else if (author) {
          color = `hsl(${friendHue(author)}, 65%, 50%)`;
        } else if (favCampIds.has(id)) {
          color = '#f59e0b';
        } else {
          color = 'var(--accent)';
        }
        out.push({
          key,
          x: p.x, y: p.y,
          address: camp.location,
          label: author ? `${author}'s camp — ${camp.name}` : camp.name,
          kind: 'camp',
          color,
        });
      } else if (key.startsWith('mine:')) {
        const idx = parseInt(key.slice('mine:'.length), 10);
        const m = myMeetPins.find((p) => p.idx === idx);
        if (!m) continue;
        out.push({
          key, x: m.x, y: m.y,
          address: m.spot.address, label: m.spot.label, kind: 'mine',
          color: 'var(--meet)',
        });
      } else if (key.startsWith('friend:')) {
        const rest = key.slice('friend:'.length);
        const lastColon = rest.lastIndexOf(':');
        const name = rest.slice(0, lastColon);
        const idx = parseInt(rest.slice(lastColon + 1), 10);
        const f = friendMeetPins.find((p) => p.name === name && p.idx === idx);
        if (!f) continue;
        out.push({
          key, x: f.x, y: f.y,
          address: f.spot.address,
          label: `${f.spot.label} · ${f.name}`,
          kind: 'friend',
          color: `hsl(${friendHue(f.name)}, 65%, 50%)`,
        });
      } else if (key.startsWith('poi:')) {
        const rest = key.slice('poi:'.length);
        const sep = rest.indexOf(':');
        const kind = rest.slice(0, sep);
        const name = rest.slice(sep + 1);
        const hit = poiPins.find(
          ({ poi }) => poi.kind === kind && poi.name === name,
        );
        if (!hit) continue;
        // Same hex used by `.map-poi-{kind}` + `.brc-poi-{kind}-dot`.
        let color = 'var(--muted)';
        if (kind === 'center-camp') color = '#dc2626';
        else if (kind === 'playa-info') color = '#0369a1';
        out.push({
          key, x: hit.x, y: hit.y,
          address: hit.poi.address, label: hit.poi.name, kind: 'poi',
          color,
        });
      }
    }
    return out;
  }, [selection, pins, myCampPin, friendCampPins,
      myMeetPins, friendMeetPins, poiPins, favCampIds]);

  // When the user picks exactly one pin / spot / POI while zoomed in,
  // pan the viewBox over so the selection is visible. With multi we
  // can't sensibly auto-recenter (the centroid could be off-map), so
  // pan only fires for single-select.
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

  // (Bearing/distance/ETA are now computed per-row by `navFor` —
  // the previous `spotInfo` / `targetInfo` memos were single-target
  // only and went unused once we moved to inline expansion.)

  function externalMapsUrl(c: Camp) {
    const ll = addressToLatLng(c.location);
    if (!ll) return null;
    return `https://www.google.com/maps?q=${ll.lat},${ll.lng}`;
  }

  // Per-item bearing + distance — used by expanded list rows where each
  // selected item shows its own nav details (multi-select friendly).
  // Returns null when GPS isn't on or the address doesn't parse to lat/lng.
  function navFor(address: string): { meters: number; bearing: number } | null {
    if (geo.status !== 'ready') return null;
    const ll = addressToLatLng(address);
    if (!ll) return null;
    return {
      meters: haversineMeters({ lat: geo.lat, lng: geo.lng }, ll),
      bearing: bearingDeg({ lat: geo.lat, lng: geo.lng }, ll),
    };
  }

  // Reusable nav-block renderer — shared by every row type's
  // expanded form. `address` is what the row points at; `gpsHint`
  // toggles the "tap Use my GPS" footnote when no fix is available.
  function NavBlock({ address }: { address: string }) {
    const nav = navFor(address);
    if (nav) {
      const e = etaMinutes(nav.meters);
      return (
        <>
          <div class="row-nav">
            <strong>{Math.round(nav.meters)} m</strong> away,
            bearing <strong>{Math.round(nav.bearing)}&deg;</strong>
            {' '}(compass {compassCardinal(nav.bearing)})
          </div>
          <div class="row-eta">
            ~{e.walk} min walk &middot; {e.bike} min bike
          </div>
        </>
      );
    }
    if (geo.status === 'ready') {
      return <div class="row-footnote">Couldn't resolve this address to lat/lng.</div>;
    }
    return <div class="row-footnote">Tap "Use my GPS" above for distance + bearing.</div>;
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
          {selection.size > 0 && (
            <button
              type="button"
              class="map-clear-btn"
              aria-label="Clear all selections"
              title="Clear all selections from the map"
              onClick={() => clearSelection()}
            >
              Clear ({selection.size})
            </button>
          )}
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
            {/* Sticky details pane removed — each selected row expands
                in place below (see the row blocks). Lets multi-select
                show details for every picked item simultaneously. */}
            {myCampPin && (() => {
              const active = selection.has(campKey(myCampPin.camp.id));
              return (
                <div
                  class={'map-my-camp-row' + (active ? ' active' : '')}
                  onClick={() => toggleKey(campKey(myCampPin.camp.id))}
                >
                  <span class="map-my-camp-icon" aria-hidden="true"><TentIcon size={18} /></span>
                  <div class="map-my-camp-body">
                    <div class="map-my-camp-name">Your camp — {myCampPin.camp.name}</div>
                    <div class="map-pin-addr">{myCampPin.camp.location}</div>
                    {active && (
                      <div class="row-details">
                        <NavBlock address={myCampPin.camp.location} />
                        <div class="row-actions">
                          <button
                            type="button" class="map-ext-link"
                            onClick={(e) => { e.stopPropagation(); onGotoCamp(myCampPin.camp.id); }}
                          >Open camp card →</button>
                          {externalMapsUrl(myCampPin.camp) && (
                            <a
                              class="map-ext-link"
                              href={externalMapsUrl(myCampPin.camp)!}
                              target="_blank" rel="noopener"
                              onClick={(e) => e.stopPropagation()}
                            >Open in Google Maps ↗</a>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
            {meetSpots.length === 0 && !myCampPin && (
              <p class="map-rendezvous-hint">
                Set a camp card as <strong>my camp</strong> in the Camps
                view, or add a spot here. Anything you add rides along
                when you share — friends see it on their map after
                importing.
              </p>
            )}
            {meetSpots.length > 0 && (() => {
              const sectionExpanded = isSectionExpanded('meet');
              const selectedCount = meetSpots.reduce(
                (n, _s, i) => n + (selection.has(mineSpotKey(i)) ? 1 : 0),
                0,
              );
              const visibleSpots = sectionExpanded
                ? meetSpots.map((s, i) => ({ s, i }))
                : meetSpots
                    .map((s, i) => ({ s, i }))
                    .filter(({ i }) => selection.has(mineSpotKey(i)));
              return (
                <>
                  <div class="map-section-toggle">
                    <button
                      type="button"
                      class="map-section-toggle-btn"
                      onClick={() => toggleSection('meet')}
                    >
                      {sectionExpanded ? '▾' : '▸'}{' '}
                      Your meet spots ({meetSpots.length})
                      {!sectionExpanded && selectedCount > 0 && (
                        <span class="count"> · {selectedCount} selected</span>
                      )}
                    </button>
                  </div>
                  {visibleSpots.length > 0 && (
                    <ul class="map-meet-list">
                      {visibleSpots.map(({ s: spot, i: idx }) => {
                  const active = selection.has(mineSpotKey(idx));
                  return (
                    <li
                      key={`spot-${idx}`}
                      class={'map-meet-row clickable' + (active ? ' active' : '')}
                      onClick={() => toggleKey(mineSpotKey(idx))}
                    >
                      <span class="map-meet-dot mine" aria-hidden="true" />
                      <div class="map-meet-body">
                        <div class="map-meet-label">{spot.label}</div>
                        <div class="map-pin-addr">
                          {spot.address}{spot.when ? ` · ${spot.when}` : ''}
                        </div>
                        {active && (
                          <div class="row-details">
                            <NavBlock address={spot.address} />
                          </div>
                        )}
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
                </>
              );
            })()}
            {poiPins.length > 0 && (() => {
              const sectionExpanded = isSectionExpanded('landmarks');
              const selectedCount = poiPins.reduce(
                (n, { poi }) => n + (selection.has(poiKey(poi.kind, poi.name)) ? 1 : 0),
                0,
              );
              const visiblePois = sectionExpanded
                ? poiPins
                : poiPins.filter(
                  ({ poi }) => selection.has(poiKey(poi.kind, poi.name)),
                );
              return (
                <>
                  <div class="map-section-toggle">
                    <button
                      type="button"
                      class="map-section-toggle-btn"
                      onClick={() => toggleSection('landmarks')}
                    >
                      {sectionExpanded ? '▾' : '▸'}{' '}
                      Landmarks ({poiPins.length})
                      {!sectionExpanded && selectedCount > 0 && (
                        <span class="count"> · {selectedCount} selected</span>
                      )}
                    </button>
                  </div>
                  {visiblePois.length > 0 && (
                    <ul class="map-meet-list">
                      {visiblePois.map(({ poi }) => {
                    const active = selection.has(poiKey(poi.kind, poi.name));
                    return (
                      <li
                        key={`poi-${poi.kind}-${poi.name}`}
                        class={'map-meet-row clickable' + (active ? ' active' : '')}
                        onClick={() => {
                          toggleKey(poiKey(poi.kind, poi.name));
                        }}
                      >
                        <span class={`map-poi-dot map-poi-${poi.kind}`} aria-hidden="true" />
                        <div class="map-meet-body">
                          <div class="map-meet-label">{poi.name}</div>
                          <div class="map-pin-addr">{poi.address}</div>
                          {poi.description && (
                            <div class="row-poi-desc">{poi.description}</div>
                          )}
                          {active && (
                            <div class="row-details">
                              <NavBlock address={poi.address} />
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                    </ul>
                  )}
                </>
              );
            })()}
            {friendsRendezvous.some((f) => f.myCampId || (f.meetSpots && f.meetSpots.length > 0)) && (() => {
              const sectionExpanded = isSectionExpanded('friends');
              const totalFriends = friendCampPins.length + friendMeetPins.length;
              const selectedCount =
                friendCampPins.reduce((n, fp) => n + (selection.has(campKey(fp.camp.id)) ? 1 : 0), 0)
                + friendMeetPins.reduce((n, fm) => n + (selection.has(friendSpotKey(fm.name, fm.idx)) ? 1 : 0), 0);
              const visibleFriendCamps = sectionExpanded
                ? friendCampPins
                : friendCampPins.filter((fp) => selection.has(campKey(fp.camp.id)));
              const visibleFriendSpots = sectionExpanded
                ? friendMeetPins
                : friendMeetPins.filter((fm) => selection.has(friendSpotKey(fm.name, fm.idx)));
              const anyVisible = visibleFriendCamps.length + visibleFriendSpots.length > 0;
              return (
              <>
                <div class="map-section-toggle">
                  <button
                    type="button"
                    class="map-section-toggle-btn"
                    onClick={() => toggleSection('friends')}
                  >
                    {sectionExpanded ? '▾' : '▸'}{' '}
                    Friends' plans ({totalFriends})
                    {!sectionExpanded && selectedCount > 0 && (
                      <span class="count"> · {selectedCount} selected</span>
                    )}
                  </button>
                </div>
                {anyVisible && (
                <ul class="map-meet-list">
                  {visibleFriendCamps.map((fp) => {
                    const active = selection.has(campKey(fp.camp.id));
                    return (
                      <li
                        key={`fc-${fp.name}-${fp.camp.id}`}
                        class={'map-meet-row clickable' + (active ? ' active' : '')}
                        onClick={() => toggleKey(campKey(fp.camp.id))}
                      >
                        <span class="map-friend-tent" aria-hidden="true" style={friendHueStyle(fp.name)}><TentIcon size={16} /></span>
                        <div class="map-meet-body">
                          <div class="map-meet-label">
                            {fp.camp.name}
                            {' '}
                            <span class="fav-by-chip" style={friendChipStyle(fp.name)}>{fp.name}</span>
                          </div>
                          <div class="map-pin-addr">{fp.camp.location}</div>
                          {active && (
                            <div class="row-details">
                              <NavBlock address={fp.camp.location} />
                              <div class="row-actions">
                                <button
                                  type="button" class="map-ext-link"
                                  onClick={(e) => { e.stopPropagation(); onGotoCamp(fp.camp.id); }}
                                >Open camp card →</button>
                                {externalMapsUrl(fp.camp) && (
                                  <a
                                    class="map-ext-link"
                                    href={externalMapsUrl(fp.camp)!}
                                    target="_blank" rel="noopener"
                                    onClick={(e) => e.stopPropagation()}
                                  >Open in Google Maps ↗</a>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                  {visibleFriendSpots.map((fm) => {
                    const active = selection.has(friendSpotKey(fm.name, fm.idx));
                    return (
                      <li
                        key={`fm-${fm.name}-${fm.idx}`}
                        class={'map-meet-row clickable' + (active ? ' active' : '')}
                        onClick={() => {
                          toggleKey(friendSpotKey(fm.name, fm.idx));
                        }}
                      >
                        <span class="map-meet-dot friend" aria-hidden="true" style={friendHueStyle(fm.name)} />
                        <div class="map-meet-body">
                          <div class="map-meet-label">
                            {fm.spot.label}
                            {' '}
                            <span class="fav-by-chip" style={friendChipStyle(fm.name)}>{fm.name}</span>
                          </div>
                          <div class="map-pin-addr">
                            {fm.spot.address}{fm.spot.when ? ` · ${fm.spot.when}` : ''}
                          </div>
                          {active && (
                            <div class="row-details">
                              <NavBlock address={fm.spot.address} />
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                )}
              </>
              );
            })()}
          </div>

          {/* Pin list + navigation details. Placed ABOVE the map SVG
              so the "tap a row → see it on the map below" flow reads
              top-to-bottom: pick a camp in the list, scroll (or glance)
              down to the SVG to see its location + bearing. */}
          {(() => {
            const sectionExpanded = isSectionExpanded('starred');
            // Are there any imported friends in play? Drives whether
            // every row shows the "you" chip (so multiple-owner rows
            // don't read inconsistently against single-owner ones).
            const hasAnyFriends =
              friendCampPins.length > 0
              || friendMeetPins.length > 0
              || pins.some((p) => p.friends.length > 0);
            const selectedCount = pins.reduce(
              (n, p) => n + (selection.has(campKey(p.camp.id)) ? 1 : 0),
              0,
            );
            const visiblePins = sectionExpanded
              ? pins
              : pins.filter((p) => selection.has(campKey(p.camp.id)));
            return (
          <div class="map-list">
            <div class="map-section-toggle">
              <button
                type="button"
                class="map-section-toggle-btn"
                onClick={() => toggleSection('starred')}
              >
                {sectionExpanded ? '▾' : '▸'}{' '}
                Starred camps ({pins.length})
                {!sectionExpanded && selectedCount > 0 && (
                  <span class="count"> · {selectedCount} selected</span>
                )}
              </button>
            </div>
            {visiblePins.length > 0 && (
            <ul>
              {visiblePins.map((p) => {
                const active = selection.has(campKey(p.camp.id));
                const youStarredCamp = favCampIds.has(p.camp.id);
                return (
                  <li
                    key={p.camp.id}
                    class={'map-pin-row' + (active ? ' active' : '')}
                    onClick={() => toggleKey(campKey(p.camp.id))}
                  >
                    <span class={'map-pin-dot' + (p.mine ? ' mine' : '')} aria-hidden="true" />
                    <span class="map-pin-mid">
                      <span class="map-pin-name">{p.camp.name}</span>
                      {(p.mine || p.friends.length > 0) && hasAnyFriends && (
                        <span class="map-pin-friends">
                          {/* Once any friend's stars are in the picture,
                              every row consistently shows who starred
                              it (you + their nicknames). Without that,
                              some rows would have a "you" chip and
                              others wouldn't, which reads confusingly.
                              When no friends are imported at all the
                              whole chip strip is suppressed — the
                              "Starred camps" header alone says they're
                              yours. */}
                          {p.mine && (
                            <span class="fav-by-chip mine">you</span>
                          )}
                          {p.friends.map((n) => (
                            <span
                              key={`f-${n}`}
                              class="fav-by-chip"
                              style={friendChipStyle(n)}
                            >{n}</span>
                          ))}
                        </span>
                      )}
                    </span>
                    <span class="map-pin-addr">{p.camp.location}</span>
                    {active && (
                      <div class="row-details">
                        {(youStarredCamp || p.friends.length > 0) && (
                          <div class="row-faved">
                            Starred by{' '}
                            {youStarredCamp && (
                              <span class="fav-by-chip mine">you</span>
                            )}
                            {p.friends.map((n) => (
                              <span
                                key={`fd-${n}`}
                                class="fav-by-chip"
                                style={friendChipStyle(n)}
                              >{n}</span>
                            ))}
                          </div>
                        )}
                        <NavBlock address={p.camp.location} />
                        {(() => {
                          const starred = (p.camp.events ?? []).filter(
                            (e) => favEventIds.has(e.id) || friendFavEventIds(e.id).length > 0,
                          );
                          if (starred.length === 0) return null;
                          return (
                            <div class="row-events">
                              <div class="row-events-head">
                                Starred events at this camp
                              </div>
                              <ul>
                                {starred.map((e) => {
                                  const eventFriends = friendFavEventIds(e.id);
                                  const youStarred = favEventIds.has(e.id);
                                  return (
                                    <li key={e.id}>
                                      <a
                                        href={`https://directory.burningman.org/events/${encodeURIComponent(e.id)}/`}
                                        target="_blank" rel="noopener"
                                        onClick={(ev) => ev.stopPropagation()}
                                      >{e.name}</a>
                                      {e.display_time && <span class="map-ev-time"> · {e.display_time}</span>}
                                      {(youStarred || eventFriends.length > 0) && (
                                        <span class="map-ev-faved">
                                          {youStarred && (
                                            <span class="fav-by-chip mine">you</span>
                                          )}
                                          {eventFriends.map((n) => (
                                            <span
                                              key={`fe-${n}`}
                                              class="fav-by-chip"
                                              style={friendChipStyle(n)}
                                            >{n}</span>
                                          ))}
                                        </span>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          );
                        })()}
                        <div class="row-actions">
                          <button
                            type="button" class="map-ext-link"
                            onClick={(e) => { e.stopPropagation(); onGotoCamp(p.camp.id); }}
                          >Open camp card →</button>
                          {externalMapsUrl(p.camp) && (
                            <a
                              class="map-ext-link"
                              href={externalMapsUrl(p.camp)!}
                              target="_blank" rel="noopener"
                              onClick={(e) => e.stopPropagation()}
                            >Open in Google Maps ↗</a>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            )}
          </div>
            );
          })()}

          <Svg
            pins={pins}
            target={target}
            targetAddress={target ? parseAddress(target.camp.location) : null}
            userSvg={userSvg}
            selection={selection}
            toggleKey={toggleKey}
            onClearSelection={clearSelection}
            myCampPin={myCampPin}
            myMeetPins={myMeetPins}
            friendCampPins={friendCampPins}
            friendMeetPins={friendMeetPins}
            activeSpot={activeSpot}
            activeSpotAddress={activeSpot ? parseAddress(activeSpot.address) : null}
            selectedItems={selectedItems}
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
  pins, target, targetAddress, userSvg, onClearSelection,
  myCampPin, myMeetPins, friendCampPins, friendMeetPins,
  selection, toggleKey, activeSpot, activeSpotAddress,
  selectedItems, poiPins, zoom, center, setCenter,
}: {
  pins: Array<{ camp: Camp; x: number; y: number; mine: boolean; friends: string[] }>;
  /** Single-select view — populated only when exactly one camp is in
   *  the selection set. Drives the big near-Man label + GPS bearing
   *  line, both of which only make sense for a single target. */
  target: {
    camp: Camp; x: number; y: number;
    author: string | null;
    kind: 'fav' | 'mine' | 'friend';
    color: string;
  } | null;
  /** Parsed address for the single selected camp. Null in multi mode. */
  targetAddress: {
    clockHour: number; radiusFeet: number;
    clock: string; street: string;
  } | null;
  userSvg: { x: number; y: number } | null;
  /** Click on empty SVG canvas drops the entire selection set. */
  onClearSelection: () => void;
  myCampPin: { camp: Camp; x: number; y: number } | null;
  myMeetPins: Array<{ spot: MeetSpot; idx: number; x: number; y: number }>;
  friendCampPins: Array<{ name: string; camp: Camp; x: number; y: number }>;
  friendMeetPins: Array<{ name: string; spot: MeetSpot; idx: number; x: number; y: number }>;
  /** Multi-select set of typed keys (camp:<id>, mine:<idx>, …). */
  selection: Set<string>;
  /** Add/remove a key from the selection. */
  toggleKey: (key: string) => void;
  /** Single-spot view of the multi-selection — null in multi mode. */
  activeSpot: {
    label: string; address: string; when?: string;
    description?: string;
    x: number; y: number; author: string | null;
    isPoi: boolean;
    color: string;
  } | null;
  /** parseAddress() output for activeSpot — null in multi mode. */
  activeSpotAddress: {
    clockHour: number; radiusFeet: number;
    clock: string; street: string;
  } | null;
  /** Multi-select rendering source. Each item carries x/y + label +
   *  raw address; the SVG draws one highlight per entry plus a line
   *  label when there are 2 or more. */
  selectedItems: Array<{
    key: string; x: number; y: number;
    address: string; label: string;
    kind: 'camp' | 'mine' | 'friend' | 'poi';
    color: string;
  }>;
  poiPins: Array<{ poi: BrcPOI; x: number; y: number }>;
  zoom: number;
  center: { x: number; y: number };
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
          <g
            class="brc-highlight spot"
            style={{ '--highlight-color': activeSpot.color } as JSX.CSSProperties}
          >
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
          <g
            class="brc-highlight"
            style={{ '--highlight-color': target.color } as JSX.CSSProperties}
          >
            <line x1={0} y1={0} x2={radialEnd.x} y2={radialEnd.y} class="brc-highlight-radial" />
            <path d={arcD} class="brc-highlight-ring" fill="none" />
            <circle cx={target.x} cy={target.y} r={180} class="brc-highlight-halo" />
          </g>
        );
      })()}

      {/* Multi-select highlights. Only fires when 2+ items are picked;
          single-select uses the type-specific target / activeSpot
          blocks above so the camp-orange / spot-violet styling reads
          correctly.

          Label split:
            - NAME sits at the item (horizontal, just above the halo)
              so it reads naturally regardless of the radial's clock
              hour. Different items naturally separate by their pin
              positions, not by a shared midpoint.
            - ADDRESS rides along the radial, rotated to match it,
              with a tight perpendicular offset (~1 px on screen) so
              it visually hugs the line without crossing it. */}
      {selectedItems.length >= 2 && selectedItems.map((item) => {
        const addr = parseAddress(item.address);
        if (!addr) return null;
        const outerR = BRC.streetRadiiFeet[BRC.streetRadiiFeet.length - 1] + 150;
        const radialEnd = hourToSvgPoint(addr.clockHour, outerR);
        const span = 0.6;
        const arcD = arcPolylinePath(
          addr.clockHour - span, addr.clockHour + span,
          addr.radiusFeet, 12,
        );
        const cls = item.kind === 'camp' ? 'brc-highlight'
          : item.kind === 'poi' ? 'brc-highlight poi'
          : 'brc-highlight spot';
        // Address: place along the radial at 50% of the way from the
        // Man to the item, perpendicular-offset by a tiny amount so
        // the text hugs the line instead of crossing it.
        const len = Math.hypot(item.x, item.y) || 1;
        const ux = item.x / len;
        const uy = item.y / len;
        const addrR = len * 0.5;
        // Perpendicular direction — rotated 90° CCW from the radial.
        // Pick the one that points "up" in screen coords for visual
        // consistency (label always sits on the same screen-side).
        let perpX = -uy;
        let perpY = ux;
        if (perpY > 0) { perpX = -perpX; perpY = -perpY; }
        const tinyOff = 50;   // ~1–3 px on screen depending on width
        const addrCx = ux * addrR + perpX * tinyOff;
        const addrCy = uy * addrR + perpY * tinyOff;
        // Rotation follows the radial; flip 180° on the upper half so
        // text reads upright at every clock position.
        let angle = (Math.atan2(item.y, item.x) * 180) / Math.PI;
        if (angle > 90 || angle < -90) angle += 180;
        // Name dy: offset above the halo (r=180). Negative dy in SVG
        // means "up the page" → halo is cleared with ~40 units of
        // breathing room. Horizontal text, never rotated.
        const nameDy = -220;
        return (
          <g
            key={item.key}
            class={cls + ' multi'}
            style={{ '--highlight-color': item.color } as JSX.CSSProperties}
          >
            <line x1={0} y1={0} x2={radialEnd.x} y2={radialEnd.y} class="brc-highlight-radial" />
            <path d={arcD} class="brc-highlight-ring" fill="none" />
            <circle cx={item.x} cy={item.y} r={180} class="brc-highlight-halo" />
            <text
              x={item.x} y={item.y}
              dy={nameDy}
              text-anchor="middle"
              class="brc-line-label brc-line-name"
            >{item.label}</text>
            <text
              transform={`translate(${addrCx}, ${addrCy}) rotate(${angle})`}
              text-anchor="middle"
              class="brc-line-label brc-line-addr"
            >{addr.clock} &amp; {addr.street}</text>
          </g>
        );
      })}

      {/* Bearing line from user to single selection. Multi-select
          drops it — there's no clear "where am I going?" with N≥2.
          Color matches the target's dot so the line reads as an
          extension of the dot, not a separate visual layer. */}
      {userSvg && (target || activeSpot) && (
        <line
          x1={userSvg.x} y1={userSvg.y}
          x2={target ? target.x : activeSpot!.x}
          y2={target ? target.y : activeSpot!.y}
          class="brc-bearing"
          style={{
            '--highlight-color': target ? target.color : activeSpot!.color,
          } as JSX.CSSProperties}
        />
      )}

      {/* Static POIs — landmarks like Center Camp + Playa Info. Sized
          larger than the starred-camp pins so these "everyone's
          reference points" read as anchors of the map. Drawn before
          the user-authored pins so a starred camp at the same spot
          wouldn't be covered over. */}
      {poiPins.map(({ poi, x, y }) => {
        const active = selection.has(poiKey(poi.kind, poi.name));
        return (
          <g
            key={`poi-${poi.kind}-${poi.name}`}
            class={`brc-poi brc-poi-${poi.kind}` + (active ? ' active' : '')}
            transform={`translate(${x} ${y})`}
            onClick={(e) => {
              e.stopPropagation();
              toggleKey(poiKey(poi.kind, poi.name));
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
          class={'brc-pin' + (selection.has(campKey(p.camp.id)) ? ' active' : '') + (p.mine ? ' mine' : ' friend')}
          transform={`translate(${p.x} ${p.y})`}
          onClick={(e) => {
            e.stopPropagation();
            toggleKey(campKey(p.camp.id));
          }}
        >
          {/* Invisible hit-catcher — see comment on `brc-pin-hit`. */}
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
          class={'brc-my-camp' + (selection.has(campKey(myCampPin.camp.id)) ? ' active' : '')}
          transform={`translate(${myCampPin.x} ${myCampPin.y})`}
          onClick={(e) => { e.stopPropagation(); toggleKey(campKey(myCampPin.camp.id)); }}
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
      {/* Friends' home camps — tent shape in each friend's hue. The
          nickname renders directly below the tent so a glance at the
          map is enough to know whose camp is whose, no tap needed. */}
      {friendCampPins.map((fp) => (
        <g
          key={`friend-camp-${fp.name}-${fp.camp.id}`}
          class={'brc-friend-camp' + (selection.has(campKey(fp.camp.id)) ? ' active' : '')}
          transform={`translate(${fp.x} ${fp.y})`}
          onClick={(e) => { e.stopPropagation(); toggleKey(campKey(fp.camp.id)); }}
          style={friendHueStyle(fp.name)}
        >
          <circle r={150} class="brc-pin-hit" />
          <circle r={80} class="brc-friend-camp-halo" />
          <path d="M -45 32 L 0 -40 L 45 32 Z" class="brc-friend-camp-body" />
          <text x={0} y={130} class="brc-friend-label" text-anchor="middle">{fp.name}</text>
          <title>{fp.name}'s camp — {fp.camp.name}</title>
        </g>
      ))}
      {/* Your meet spots — bright violet dots. The whole map reads as
          a graph of dots; meet spots used to be diamonds with text
          labels under them, which stood out oddly on a phone. Now
          they're just bright dots with a generous hit-catcher. The
          sidebar surfaces label + nickname for any selection. */}
      {myMeetPins.map((mp) => {
        const active = selection.has(mineSpotKey(mp.idx));
        return (
          <g
            key={`my-spot-${mp.idx}`}
            class={'brc-meet' + (active ? ' active' : '')}
            transform={`translate(${mp.x} ${mp.y})`}
            onClick={(e) => {
              e.stopPropagation();
              toggleKey(mineSpotKey(mp.idx));
            }}
          >
            <circle r={150} class="brc-pin-hit" />
            <circle r={60} class="brc-meet-dot" />
            <title>{mp.spot.label} — {mp.spot.address}{mp.spot.when ? ` · ${mp.spot.when}` : ''}</title>
          </g>
        );
      })}
      {/* Friends' meet spots — bright dots tinted with friend hue. */}
      {friendMeetPins.map((fm) => {
        const active = selection.has(friendSpotKey(fm.name, fm.idx));
        return (
          <g
            key={`fr-spot-${fm.name}-${fm.idx}`}
            class={'brc-meet friend' + (active ? ' active' : '')}
            transform={`translate(${fm.x} ${fm.y})`}
            style={friendHueStyle(fm.name)}
            onClick={(e) => {
              e.stopPropagation();
              toggleKey(friendSpotKey(fm.name, fm.idx));
            }}
          >
            <circle r={150} class="brc-pin-hit" />
            <circle r={60} class="brc-meet-dot" />
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
