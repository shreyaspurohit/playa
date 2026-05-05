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
import type { Art, Camp, MeetSpot, Source } from '../types';
import { LS } from '../types';
import { readString, writeString } from '../utils/storage';
import type { BrcMapData, BrcPOI } from '../map/data';
import { POIS } from '../map/data';
import {
  addressToSvgFeet, addressToLatLng, bearingDeg, haversineMeters,
  latLngToSvgFeet, latLngToAddress, parseAddress,
} from '../map/address';
import { useGeolocation } from '../hooks/useGeolocation';
import { brcForSource } from '../hooks/useSource';
import { friendChipStyle, friendHue } from '../utils/friendColor';
import { FriendChip } from './FriendChip';
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
  /** Art for the active source (full list — not pre-filtered). The
   *  map only pins art the user OR a friend has starred. */
  art: Art[];
  favArtIds: Set<string>;
  friendFavArtIds: (id: string) => string[];
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
  /** Same shape as `initialTargetId` but for art — Art tab's
   *  per-card navigate button sets this when routing to Map. */
  initialArtTargetId?: string | null;
  onClearTarget?: () => void;
  onGotoCamp: (campId: string) => void;
  /** Cross-view nav handler for art (parallel to onGotoCamp). When the
   *  user clicks an art pin, jump to the Art tab + scroll to the card. */
  onGotoArt: (artId: string) => void;
  /** Per-item friend-star removal — fires from the × button on a
   *  friend chip in any of the map's sidebar lists. */
  onRemoveFriendStar: (
    friendName: string,
    kind: 'camp' | 'event' | 'art',
    id: string,
  ) => void;
  /** Remove a single meet-spot from a friend's plans. Used by the
   *  × button on friend meet-spot rows. */
  onRemoveFriendMeetSpot: (friendName: string, idx: number) => void;
  /** Active data source — drives which year's BRC geometry to use. */
  source: Source;
}

/** Base radius — sized for the city itself: K street (5400') + ~600
 *  ft buffer. Pins that extend BEYOND K (deep-playa art at 6000-
 *  10000') trigger a dynamic expansion in `Svg` (effectiveVbRadius).
 *  Without that, art pins past 6000 fall outside the viewbox. */
const VIEWBOX_RADIUS_BASE = 6000;
// City lives on the 2→6→10 bottom arc; the top half is mostly empty
// open playa. Crop the viewBox so the top margin is just enough for
// the 2:00 + 10:00 hour labels (at y≈-2875) with breathing room.
const VIEWBOX_TOP_MARGIN = 3300;
/** Buffer past the outermost pin when expanding the viewBox. Keeps
 *  the pin from sitting at the literal edge of the SVG. */
const VIEWBOX_PIN_BUFFER = 700;
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
const artKey = (id: string) => 'art:' + id;
const mineSpotKey = (idx: number) => 'mine:' + idx;
const friendSpotKey = (name: string, idx: number) =>
  'friend:' + name + ':' + idx;
const poiKey = (kind: string, name: string) => 'poi:' + kind + ':' + name;

export function MapView({
  camps, favCampIds, friendFavCampIds,
  favEventIds, friendFavEventIds,
  art, favArtIds, friendFavArtIds,
  myCampId, meetSpots, onAddMeetSpot, onRemoveMeetSpot,
  friendsRendezvous,
  initialTargetId = null, initialArtTargetId = null,
  onClearTarget, onGotoCamp, onGotoArt,
  onRemoveFriendStar, onRemoveFriendMeetSpot,
  source,
}: Props) {
  // Per-year geometry constants for the active source. Memoized so the
  // identity is stable across renders within one source (the underlying
  // object is module-static; recomputing only matters when `source`
  // flips, which is rare). Threaded into every address-math call so
  // past-year API camps render against their own year's Golden Spike +
  // street radii (ADR D11).
  const brc = useMemo(() => brcForSource(source), [source]);
  // Unified multi-selection. Each entry is a typed key so a single Set
  // can hold camps, POIs, meet spots, friend camps, friend meet spots
  // concurrently. Tap-to-toggle: every tap on a pin or sidebar row
  // adds the key, or removes it if already present. Tap on the empty
  // SVG canvas clears the whole set.
  //   camp:<id>          — any camp pin (starred, my-camp, friend's)
  //   mine:<idx>         — your meet spot at that index
  //   friend:<name>:<idx>— friend's meet spot at that index
  //   poi:<kind>:<name>  — point of interest
  const [selection, setSelection] = useState<Set<string>>(() => {
    // Initial selection from whichever external target is set on
    // mount. App.tsx ensures the two are mutually exclusive (setting
    // one clears the other), so prefer camp when both are present.
    if (initialTargetId) return new Set([campKey(initialTargetId)]);
    if (initialArtTargetId) return new Set([artKey(initialArtTargetId)]);
    return new Set();
  });
  useEffect(() => {
    // External "navigate to <X>" snaps selection to that one entity.
    if (initialTargetId) {
      setSelection(new Set([campKey(initialTargetId)]));
    } else if (initialArtTargetId) {
      setSelection(new Set([artKey(initialArtTargetId)]));
    } else {
      setSelection(new Set());
    }
  }, [initialTargetId, initialArtTargetId]);
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
  // Default center is computed dynamically below from the actual pin
  // extents (so deep-playa art doesn't fall outside the viewBox). The
  // initial state uses the camps-only base radius; the effect below
  // re-syncs once the dynamic value settles.
  const [center, setCenter] = useState(
    { x: 0, y: VIEWBOX_RADIUS_BASE / 2 - VIEWBOX_TOP_MARGIN / 2 },
  );
  const zoomIn = useCallback(
    () => setZoom((z) => Math.min(ZOOM_MAX, z * ZOOM_STEP)),
    [],
  );
  // resetCenter is recreated whenever defaultCenter changes (see below).
  const defaultCenterRef = useRef<{ x: number; y: number } | null>(null);
  const zoomOut = useCallback(
    () => setZoom((z) => {
      const next = Math.max(ZOOM_MIN, z / ZOOM_STEP);
      // Re-anchor to the full-city view once we're back to 1x so the
      // user doesn't land on an off-center frame.
      if (next === ZOOM_MIN && defaultCenterRef.current) {
        setCenter(defaultCenterRef.current);
      }
      return next;
    }),
    [],
  );
  const resetZoom = useCallback(
    () => {
      setZoom(1);
      if (defaultCenterRef.current) setCenter(defaultCenterRef.current);
    },
    [],
  );

  // Distance unit preference — drives the between-pins label and the
  // per-row nav distance. Persisted across sessions; default imperial
  // since the burn audience is overwhelmingly US-based.
  const [unit, setUnit] = useState<DistanceUnit>(() => {
    const stored = readString(LS.distanceUnit, 'imperial');
    return stored === 'metric' ? 'metric' : 'imperial';
  });
  const toggleUnit = useCallback(() => {
    setUnit((u) => {
      const next: DistanceUnit = u === 'imperial' ? 'metric' : 'imperial';
      writeString(LS.distanceUnit, next);
      return next;
    });
  }, []);

  // (Selection state lives above as `selection`. `target` and
  // `activeSpot` are derived single-selection views below for code
  // paths that pre-date multi-select — they're populated only when
  // exactly one item is selected.)

  const { state: geo, request: requestGps, stop: stopGps } = useGeolocation();

  // True when no camp in the current source has a usable location
  // string. Distinguishes "data not yet released" (e.g., pre-burn
  // current-year API source) from "user just hasn't pinned anything
  // yet" — the empty-state copy below picks the right message off
  // this flag rather than blaming the user when the data is upstream-
  // embargoed.
  const noLocationsAvailable = useMemo(
    () => camps.length > 0 && !camps.some((c) => c.location && c.location.trim()),
    [camps],
  );

  // Your own meet-spot pins — computed once per meetSpots change.
  const myMeetPins = useMemo(() => {
    return meetSpots
      .map((spot, idx) => {
        const pt = addressToSvgFeet(spot.address, brc);
        return pt ? { spot, idx, x: pt.x, y: pt.y } : null;
      })
      .filter(Boolean) as Array<{ spot: MeetSpot; idx: number; x: number; y: number }>;
  }, [meetSpots, brc]);

  // Friends' camps (from their imported myCampId + our camps list).
  const friendCampPins = useMemo(() => {
    const campsById = new Map(camps.map((c) => [c.id, c]));
    const out: Array<{ name: string; camp: Camp; x: number; y: number }> = [];
    for (const fr of friendsRendezvous) {
      if (!fr.myCampId) continue;
      const camp = campsById.get(fr.myCampId);
      if (!camp) continue;
      const pt = addressToSvgFeet(camp.location, brc);
      if (!pt) continue;
      out.push({ name: fr.name, camp, x: pt.x, y: pt.y });
    }
    return out;
  }, [friendsRendezvous, camps, brc]);

  // Friends' meet-spot pins, flattened across everyone. `idx` is the
  // position within THAT friend's own spots array — carries through to
  // the selectedSpot state so click → select round-trips cleanly.
  const friendMeetPins = useMemo(() => {
    const out: Array<{ name: string; spot: MeetSpot; idx: number; x: number; y: number }> = [];
    for (const fr of friendsRendezvous) {
      (fr.meetSpots ?? []).forEach((spot, idx) => {
        const pt = addressToSvgFeet(spot.address, brc);
        if (!pt) return;
        out.push({ name: fr.name, spot, idx, x: pt.x, y: pt.y });
      });
    }
    return out;
  }, [friendsRendezvous, brc]);

  // Static POI pins (Center Camp, Playa Info, etc. from map/data.ts).
  // Resolved once per BRC refresh — addresses don't change within a
  // build, so this memo is effectively constant.
  const poiPins = useMemo(() => {
    return POIS
      .map((poi) => {
        const pt = addressToSvgFeet(poi.address, brc);
        return pt ? { poi, x: pt.x, y: pt.y } : null;
      })
      .filter(Boolean) as Array<{ poi: BrcPOI; x: number; y: number }>;
  }, [brc]);

  // Your own camp, if set — rendered as a dedicated accent pin.
  const myCampPin = useMemo(() => {
    if (!myCampId) return null;
    const camp = camps.find((c) => c.id === myCampId);
    if (!camp) return null;
    const pt = addressToSvgFeet(camp.location, brc);
    return pt ? { camp, x: pt.x, y: pt.y } : null;
  }, [myCampId, camps, brc]);

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
      else if (kind === 'plaza') color = '#0d9488';
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
        const pt = addressToSvgFeet(camp.location, brc);
        if (!pt) return null;
        const mine = favCampIds.has(camp.id);
        const friends = friendFavCampIds(camp.id);
        return { camp, x: pt.x, y: pt.y, mine, friends };
      })
      .filter(Boolean) as Array<{
        camp: Camp; x: number; y: number; mine: boolean; friends: string[];
      }>;
  }, [camps, favCampIds, friendFavCampIds, brc]);

  // Starred art for THIS source (own + friends'). Doesn't require a
  // resolvable address — we still want to LIST a starred piece even
  // when its location is missing (e.g., pre-burn API source where
  // BM hasn't released art locations yet). Rows with no resolvable
  // address render in the list as "(no location)" and skip the SVG
  // pin layer.
  const starredArtList = useMemo(() => {
    return art
      .filter((a) => favArtIds.has(a.id) || friendFavArtIds(a.id).length > 0)
      .map((piece) => {
        const mine = favArtIds.has(piece.id);
        const friends = friendFavArtIds(piece.id);
        return { art: piece, mine, friends };
      });
  }, [art, favArtIds, friendFavArtIds]);

  // Art pins for the SVG layer — restricted to entries with
  // resolvable addresses (otherwise nothing to draw). Subset of
  // `starredArtList`.
  const artPins = useMemo(() => {
    return starredArtList
      .map(({ art: piece, mine, friends }) => {
        const pt = addressToSvgFeet(piece.location, brc);
        if (!pt) return null;
        return { art: piece, x: pt.x, y: pt.y, mine, friends };
      })
      .filter(Boolean) as Array<{
        art: Art; x: number; y: number; mine: boolean; friends: string[];
      }>;
  }, [starredArtList, brc]);

  // Dynamic viewBox sizing — covers any pin (camps, art, meet spots,
  // friend pins, my-camp). Without this, art at deep-playa addresses
  // (6000-10000 ft from the Man) falls outside the city-only base
  // viewBox.
  //
  // Two dimensions need expanding:
  //   - radius (`effectiveVbRadius`) drives width + bottom edge
  //     (viewBox is symmetric in x, extends from origin to +radius
  //     on the y-axis).
  //   - top margin (`effectiveTopMargin`) drives the top edge
  //     (viewBox extends from -topMargin upward). Default city has
  //     nothing far above origin (the 12:00 axis is open playa); but
  //     a piece at 1:44 / 6400' has y ≈ -3949, well above the
  //     default 3300-ft top margin. Without expanding, the pin falls
  //     off the top regardless of how far the radius extends.
  const { effectiveVbRadius, effectiveTopMargin } = useMemo(() => {
    let maxR = VIEWBOX_RADIUS_BASE - VIEWBOX_PIN_BUFFER;
    let maxNegY = VIEWBOX_TOP_MARGIN - VIEWBOX_PIN_BUFFER;  // |min(y)|
    const consider = (x: number, y: number) => {
      const r = Math.hypot(x, y);
      if (r > maxR) maxR = r;
      if (-y > maxNegY) maxNegY = -y;
    };
    for (const p of pins) consider(p.x, p.y);
    for (const p of artPins) consider(p.x, p.y);
    for (const p of myMeetPins) consider(p.x, p.y);
    for (const p of friendMeetPins) consider(p.x, p.y);
    for (const p of friendCampPins) consider(p.x, p.y);
    if (myCampPin) consider(myCampPin.x, myCampPin.y);
    // Nav-only target — when the user routed in to an unfavorited
    // camp/art, expand the viewBox to fit it. Without this, deep-playa
    // art the user hasn't starred lands outside the city bounds and
    // the user has to manually pan/zoom to find it.
    if (selection.size === 1) {
      const key = [...selection][0];
      let raw: string | null = null;
      if (key.startsWith('camp:')) {
        const id = key.slice('camp:'.length);
        const c = camps.find((x) => x.id === id);
        if (c) raw = c.location;
      } else if (key.startsWith('art:')) {
        const id = key.slice('art:'.length);
        const a = art.find((x) => x.id === id);
        if (a) raw = a.location;
      }
      if (raw) {
        const pt = addressToSvgFeet(raw, brc);
        if (pt) consider(pt.x, pt.y);
      }
    }
    return {
      effectiveVbRadius: Math.max(VIEWBOX_RADIUS_BASE, maxR + VIEWBOX_PIN_BUFFER),
      effectiveTopMargin: Math.max(VIEWBOX_TOP_MARGIN, maxNegY + VIEWBOX_PIN_BUFFER),
    };
  }, [
    pins, artPins, myMeetPins, friendMeetPins, friendCampPins, myCampPin,
    selection, camps, art, brc,
  ]);

  const vbWidth = effectiveVbRadius * 2;
  const vbHeight = effectiveVbRadius + effectiveTopMargin;
  const defaultCenter = useMemo(
    () => ({ x: 0, y: vbHeight / 2 - effectiveTopMargin }),
    [vbHeight, effectiveTopMargin],
  );

  // Sync the user-pannable center to the latest default whenever the
  // viewport expands (e.g., user just starred a deep-playa art piece)
  // — but only at zoom 1 so an active pan isn't ripped out from
  // under them. Mirrors the behavior of the zoom-out reset.
  useEffect(() => {
    defaultCenterRef.current = defaultCenter;
    if (zoom <= 1) setCenter(defaultCenter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCenter]);

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
    // Fallback: camp isn't starred / my-camp / friend's camp, but
    // the user navigated here from the Camps tab card. Look it up
    // in the full `camps` array so the label + halo + radial still
    // render. Drops if the address doesn't resolve (no map pin
    // possible) or the camp isn't in the active source.
    const camp = camps.find((c) => c.id === targetId);
    if (!camp) return null;
    const pt = addressToSvgFeet(camp.location, brc);
    if (!pt) return null;
    return {
      camp, x: pt.x, y: pt.y,
      author: null, kind: 'fav', friends: [],
      color: 'var(--accent)',
    };
  }, [selection, pins, myCampPin, friendCampPins, camps, brc]);

  // Single-select target for ART. Mirrors `target` (which is camp-only)
  // — fires when exactly ONE art piece is selected. Drives the same
  // big-label-near-Man rendering, auto-recenter, and GPS bearing line
  // that camps get, just keyed off the art entity. `target` and
  // `artTarget` are mutually exclusive: selection.size != 1 → both
  // null; otherwise only the one matching the selected key prefix is
  // non-null.
  const artTarget = useMemo((): {
    art: Art; x: number; y: number;
    mine: boolean;
    friends: string[];
    color: string;
  } | null => {
    if (selection.size !== 1) return null;
    const key = [...selection][0];
    if (!key.startsWith('art:')) return null;
    const targetId = key.slice('art:'.length);
    const p = artPins.find((x) => x.art.id === targetId);
    if (p) {
      // Color follows the dot: magenta when YOU starred it, teal when
      // only friends starred it. Matches `.brc-art-pin-body` fills so
      // the highlight ring reads as continuation of the pin.
      const color = p.mine ? '#c026d3' : '#14b8a6';
      return {
        art: p.art, x: p.x, y: p.y,
        mine: p.mine, friends: p.friends, color,
      };
    }
    // Fallback: art isn't starred but the user navigated here from
    // the Art tab card. Look it up in the full `art` list so the
    // label + halo + radial still render even though there's no
    // pin in the SVG layer. Drops if address doesn't resolve.
    const piece = art.find((a) => a.id === targetId);
    if (!piece) return null;
    const pt = addressToSvgFeet(piece.location, brc);
    if (!pt) return null;
    return {
      art: piece, x: pt.x, y: pt.y,
      mine: false, friends: [],
      color: '#c026d3',         // magenta — same as the art pin body
    };
  }, [selection, artPins, art, brc]);

  // Navigation-only pin for a camp the user routed to from the Camps /
  // Art tab card but hasn't starred. Without this, target's halo +
  // label would float over a blank patch of map (no underlying dot).
  // Skips when the camp is already drawn as a starred / my-camp /
  // friend-camp pin, so we never double-render.
  const navCampPin = useMemo(() => {
    if (!target) return null;
    const id = target.camp.id;
    if (pins.some((p) => p.camp.id === id)) return null;
    if (myCampPin && myCampPin.camp.id === id) return null;
    if (friendCampPins.some((fp) => fp.camp.id === id)) return null;
    return { camp: target.camp, x: target.x, y: target.y };
  }, [target, pins, myCampPin, friendCampPins]);

  // Navigation-only pin for an art piece — same idea as navCampPin.
  // Renders when the user navigates from an unfavorited art card so
  // the map shows where the piece is.
  const navArtPin = useMemo(() => {
    if (!artTarget) return null;
    const id = artTarget.art.id;
    if (artPins.some((p) => p.art.id === id)) return null;
    return { art: artTarget.art, x: artTarget.x, y: artTarget.y };
  }, [artTarget, artPins]);

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
    kind: 'camp' | 'art' | 'mine' | 'friend' | 'poi';
    /** Hex / hsl / CSS-var string the highlight (radial + ring + halo
     *  + bearing) should use. Matches the dot's actual fill so the
     *  line color reads as continuation of the dot, not a separate
     *  visual layer. */
    color: string;
  }> => {
    const out: Array<{
      key: string; x: number; y: number;
      address: string; label: string;
      kind: 'camp' | 'art' | 'mine' | 'friend' | 'poi';
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
      } else if (key.startsWith('art:')) {
        const id = key.slice('art:'.length);
        const p = artPins.find((a) => a.art.id === id);
        if (!p) continue;
        // Same mine/friend split as `artTarget`: magenta when you
        // starred it, teal otherwise (friend-only).
        const color = p.mine ? '#c026d3' : '#14b8a6';
        out.push({
          key, x: p.x, y: p.y,
          address: p.art.location,
          label: p.art.name + (p.art.artist ? ` — ${p.art.artist}` : ''),
          kind: 'art',
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
        else if (kind === 'plaza') color = '#0d9488';
        out.push({
          key, x: hit.x, y: hit.y,
          address: hit.poi.address, label: hit.poi.name, kind: 'poi',
          color,
        });
      }
    }
    return out;
  }, [selection, pins, artPins, myCampPin, friendCampPins,
      myMeetPins, friendMeetPins, poiPins, favCampIds]);

  // When the user picks exactly one pin / spot / POI while zoomed in,
  // pan the viewBox over so the selection is visible. With multi we
  // can't sensibly auto-recenter (the centroid could be off-map), so
  // pan only fires for single-select.
  useEffect(() => {
    if (zoom <= 1) return;
    if (target) setCenter({ x: target.x, y: target.y });
    else if (artTarget) setCenter({ x: artTarget.x, y: artTarget.y });
    else if (activeSpot) setCenter({ x: activeSpot.x, y: activeSpot.y });
  }, [target, artTarget, activeSpot, zoom]);

  // User GPS → SVG coordinates (only when we have a fix)
  const userSvg = geo.status === 'ready'
    ? latLngToSvgFeet({ lat: geo.lat, lng: geo.lng }, brc)
    : null;

  // User GPS → BRC address (e.g. "6:30 & B") for the situational-
  // awareness readout in the map header. Null when outside the rings.
  const userAddress = geo.status === 'ready'
    ? latLngToAddress({ lat: geo.lat, lng: geo.lng }, brc)
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
    return externalMapsUrlForAddress(c.location);
  }

  /** Given any BRC address string, return a Google Maps URL pointing
   *  at its lat/lng — null when the address doesn't resolve. Used for
   *  camps, art, meet spots, and any future entity. Google Maps can't
   *  read BRC's "7:30 & F" / "1:44 6400'" formats; we have to convert
   *  to actual lat/lng via the per-year Golden Spike + polar math. */
  function externalMapsUrlForAddress(raw: string): string | null {
    const ll = addressToLatLng(raw, brc);
    if (!ll) return null;
    return `https://www.google.com/maps?q=${ll.lat},${ll.lng}`;
  }

  // Per-item bearing + distance — used by expanded list rows where each
  // selected item shows its own nav details (multi-select friendly).
  // Returns null when GPS isn't on or the address doesn't parse to lat/lng.
  function navFor(address: string): { meters: number; bearing: number } | null {
    if (geo.status !== 'ready') return null;
    const ll = addressToLatLng(address, brc);
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
            <strong>{formatDistance(nav.meters, unit)}</strong> away,
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
          <h3 class="map-title">Black Rock City {brc.year}</h3>
          <p class="map-sub">
            The Man at <code>{brc.center.lat.toFixed(6)}, {brc.center.lng.toFixed(6)}</code>
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
            class="map-unit-btn"
            aria-label={`Distance unit: ${unit === 'imperial' ? 'imperial (mi/ft)' : 'metric (km/m)'}. Click to switch.`}
            title="Toggle imperial / metric"
            onClick={toggleUnit}
          >
            {unit === 'imperial' ? 'mi' : 'km'}
          </button>
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

      {pins.length === 0 && !myCampPin && myMeetPins.length === 0 && friendCampPins.length === 0 && friendMeetPins.length === 0 && (
        <div class="empty-state">
          {noLocationsAvailable ? (
            <>Location data not yet available for this source.</>
          ) : (
            <>
              Nothing pinned yet. Star a camp or event (auto-stars its camp),
              mark one as <strong>my camp</strong>, or add a meet spot below —
              any of those will pin to the map.
            </>
          )}
        </div>
      )}
      {/* Nav-target card — prominent, top-of-sidebar callout when the
          user routed in to a camp or art piece they haven't starred.
          Mirrors the actions a starred-pin row would offer (open the
          source card + Google Maps deep-link) so navigation feels like
          a first-class flow regardless of fav state. */}
      {navCampPin && (
        <div class="map-nav-target-box">
          <button
            type="button"
            class="map-nav-target-close"
            aria-label="Close navigation"
            title="Close navigation"
            onClick={() => clearSelection()}
          >×</button>
          <div class="map-nav-target-head">
            <span class="map-nav-target-tag">Navigating to</span>
            <strong class="map-nav-target-name">{navCampPin.camp.name}</strong>
          </div>
          {navCampPin.camp.location && (
            <div class="map-pin-addr">{navCampPin.camp.location}</div>
          )}
          <NavBlock address={navCampPin.camp.location} />
          <div class="row-actions">
            <button
              type="button" class="map-ext-link"
              onClick={() => onGotoCamp(navCampPin.camp.id)}
            >Open camp card →</button>
            {externalMapsUrlForAddress(navCampPin.camp.location) && (
              <a
                class="map-ext-link"
                href={externalMapsUrlForAddress(navCampPin.camp.location)!}
                target="_blank" rel="noopener"
              >Open in Google Maps ↗</a>
            )}
          </div>
        </div>
      )}
      {navArtPin && (
        <div class="map-nav-target-box">
          <button
            type="button"
            class="map-nav-target-close"
            aria-label="Close navigation"
            title="Close navigation"
            onClick={() => clearSelection()}
          >×</button>
          <div class="map-nav-target-head">
            <span class="map-nav-target-tag">Navigating to</span>
            <strong class="map-nav-target-name">
              🎨 {navArtPin.art.name}
              {navArtPin.art.artist ? ` — ${navArtPin.art.artist}` : ''}
            </strong>
          </div>
          {navArtPin.art.location && (
            <div class="map-pin-addr">{navArtPin.art.location}</div>
          )}
          <NavBlock address={navArtPin.art.location} />
          <div class="row-actions">
            <button
              type="button" class="map-ext-link"
              onClick={() => onGotoArt(navArtPin.art.id)}
            >Open art card →</button>
            {externalMapsUrlForAddress(navArtPin.art.location) && (
              <a
                class="map-ext-link"
                href={externalMapsUrlForAddress(navArtPin.art.location)!}
                target="_blank" rel="noopener"
              >Open in Google Maps ↗</a>
            )}
          </div>
        </div>
      )}
      {/* Always render the rendezvous box + SVG so the BRC grid + POIs
          (Center Camp, Playa Info) stay visible even when no camps have
          resolvable addresses (e.g., the current-year API source pre-
          location-release). The hint above is a contextual nudge, not a
          replacement for the map. */}
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
                            <FriendChip
                              name={fm.name}
                              onRemove={() => onRemoveFriendMeetSpot(fm.name, fm.idx)}
                            />
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
                            <FriendChip
                              key={`f-${n}`}
                              name={n}
                              onRemove={() => onRemoveFriendStar(n, 'camp', p.camp.id)}
                            />
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
                              <FriendChip
                                key={`fd-${n}`}
                                name={n}
                                onRemove={() => onRemoveFriendStar(n, 'camp', p.camp.id)}
                              />
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
                                            <FriendChip
                                              key={`fe-${n}`}
                                              name={n}
                                              onRemove={() => onRemoveFriendStar(n, 'event', e.id)}
                                            />
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

          {starredArtList.length > 0 && (() => {
            const artSectionExpanded = expandedSections.has('starred-art');
            const pinnedCount = artPins.length;
            const totalCount = starredArtList.length;
            // Selected-when-collapsed parity with camp / meet / POI
            // sections: a row that's currently in `selection` keeps
            // showing even with the section collapsed, so tapping a
            // pin auto-reveals its details in the sidebar without
            // forcing the user to expand the section first.
            const selectedCount = starredArtList.reduce(
              (n, p) => n + (selection.has(artKey(p.art.id)) ? 1 : 0),
              0,
            );
            const visibleArt = artSectionExpanded
              ? starredArtList
              : starredArtList.filter((p) => selection.has(artKey(p.art.id)));
            return (
              <div class="map-list">
                <div class="map-section-toggle">
                  <button
                    type="button"
                    class="map-section-toggle-btn"
                    onClick={() => toggleSection('starred-art')}
                  >
                    {artSectionExpanded ? '▾' : '▸'}{' '}
                    Starred art ({totalCount})
                    {pinnedCount < totalCount && (
                      <span class="count">
                        {' '}· {pinnedCount} on map
                      </span>
                    )}
                    {!artSectionExpanded && selectedCount > 0 && (
                      <span class="count"> · {selectedCount} selected</span>
                    )}
                  </button>
                </div>
                {visibleArt.length > 0 && (
                  <ul>
                    {visibleArt.map((p) => {
                      const youStarredArt = favArtIds.has(p.art.id);
                      const hasLocation = Boolean(p.art.location?.trim());
                      const active = selection.has(artKey(p.art.id));
                      return (
                        <li
                          key={`art-row-${p.art.id}`}
                          class={'map-pin-row' + (active ? ' active' : '')}
                          onClick={() => toggleKey(artKey(p.art.id))}
                        >
                          <span
                            class={'map-pin-dot map-art-dot' + (p.mine ? ' mine' : '')}
                            aria-hidden="true"
                          />
                          <span class="map-pin-mid">
                            <span class="map-pin-name">{p.art.name}</span>
                            {p.art.artist && (
                              <span class="map-pin-friends">
                                <span class="map-pin-byline">by {p.art.artist}</span>
                              </span>
                            )}
                            {(youStarredArt || p.friends.length > 0) && (
                              // Drop the `hasAnyFriends` gate that
                              // camps use — for art we always want
                              // explicit attribution (imports are the
                              // common case; the friend nickname must
                              // be visible per row, not implicit).
                              <span class="map-pin-friends">
                                {youStarredArt && (
                                  <span class="fav-by-chip mine">you</span>
                                )}
                                {p.friends.map((n) => (
                                  <FriendChip
                                    key={`af-${n}`}
                                    name={n}
                                    onRemove={() => onRemoveFriendStar(n, 'art', p.art.id)}
                                  />
                                ))}
                              </span>
                            )}
                          </span>
                          <span class={'map-pin-addr' + (hasLocation ? '' : ' empty')}>
                            {hasLocation ? p.art.location : '(no location yet)'}
                          </span>
                          {active && (
                            <div class="row-details">
                              {(youStarredArt || p.friends.length > 0) && (
                                <div class="row-faved">
                                  Starred by{' '}
                                  {youStarredArt && (
                                    <span class="fav-by-chip mine">you</span>
                                  )}
                                  {p.friends.map((n) => (
                                    <FriendChip
                                      key={`afd-${n}`}
                                      name={n}
                                      onRemove={() => onRemoveFriendStar(n, 'art', p.art.id)}
                                    />
                                  ))}
                                </div>
                              )}
                              {p.art.description && (
                                <p class="row-desc">{p.art.description}</p>
                              )}
                              {(p.art.category || p.art.program) && (
                                <div class="row-meta">
                                  {[p.art.category, p.art.program]
                                    .filter(Boolean).join(' · ')}
                                </div>
                              )}
                              {hasLocation && <NavBlock address={p.art.location} />}
                              {!hasLocation && (
                                <div class="row-footnote">
                                  No location yet — BM hasn't published
                                  art locations for this source.
                                </div>
                              )}
                              <div class="row-actions">
                                <button
                                  type="button" class="map-ext-link"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onGotoArt(p.art.id);
                                  }}
                                >Open art card →</button>
                                {(() => {
                                  const url = externalMapsUrlForAddress(p.art.location);
                                  if (!url) return null;
                                  return (
                                    <a
                                      class="map-ext-link"
                                      href={url}
                                      target="_blank" rel="noopener"
                                      onClick={(e) => e.stopPropagation()}
                                    >Open in Google Maps ↗</a>
                                  );
                                })()}
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
            artPins={artPins}
            navCampPin={navCampPin}
            navArtPin={navArtPin}
            target={target}
            targetAddress={target ? parseAddress(target.camp.location, brc) : null}
            artTarget={artTarget}
            artTargetAddress={artTarget ? parseAddress(artTarget.art.location, brc) : null}
            vbWidth={vbWidth}
            vbHeight={vbHeight}
            vbRadius={effectiveVbRadius}
            userSvg={userSvg}
            selection={selection}
            toggleKey={toggleKey}
            onClearSelection={clearSelection}
            myCampPin={myCampPin}
            myMeetPins={myMeetPins}
            friendCampPins={friendCampPins}
            friendMeetPins={friendMeetPins}
            activeSpot={activeSpot}
            activeSpotAddress={activeSpot ? parseAddress(activeSpot.address, brc) : null}
            selectedItems={selectedItems}
            poiPins={poiPins}
            zoom={zoom}
            center={center}
            setCenter={setCenter}
            unit={unit}
            brc={brc}
          />
        </>
      <MapInfoModal open={infoOpen} onClose={() => setInfoOpen(false)} brc={brc} />
      {addingSpot && (
        <MeetSpotEditor
          onSave={(spot) => { onAddMeetSpot(spot); setAddingSpot(false); }}
          onCancel={() => setAddingSpot(false)}
          brc={brc}
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

type DistanceUnit = 'imperial' | 'metric';

// 1 m = 3.28084 ft; 1 mi = 5280 ft; 1 km = 1000 m.
function feetToMeters(ft: number): number { return ft * 0.3048; }

/** Human-friendly distance string for either unit system. Switches to
 *  the smaller unit (ft / m) under ~0.1 of the major unit so a
 *  next-block hop doesn't read as "0.04 mi" — that's harder to
 *  picture than "210 ft". */
function formatDistance(meters: number, unit: DistanceUnit): string {
  if (unit === 'imperial') {
    const feet = meters / 0.3048;
    const miles = feet / 5280;
    if (miles < 0.1) return `${Math.round(feet)} ft`;
    if (miles < 10)  return `${miles.toFixed(2)} mi`;
    return `${miles.toFixed(1)} mi`;
  }
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  if (km < 10) return `${km.toFixed(2)} km`;
  return `${km.toFixed(1)} km`;
}

// --- SVG --------------------------------------------------------------

function Svg({
  pins, artPins,
  navCampPin, navArtPin,
  target, targetAddress,
  artTarget, artTargetAddress,
  vbWidth, vbHeight, vbRadius,
  userSvg, onClearSelection,
  myCampPin, myMeetPins, friendCampPins, friendMeetPins,
  selection, toggleKey, activeSpot, activeSpotAddress,
  selectedItems, poiPins, zoom, center, setCenter, unit, brc,
}: {
  pins: Array<{ camp: Camp; x: number; y: number; mine: boolean; friends: string[] }>;
  /** Starred art pins. Star shape + distinct color from camp pins.
   *  Tap toggles selection (sidebar row expands inline). */
  artPins: Array<{ art: Art; x: number; y: number; mine: boolean; friends: string[] }>;
  /** Nav-only pin for a camp the user routed to but hasn't starred.
   *  Rendered with a dashed outline so it reads "navigating here, not
   *  starred" — `null` whenever the target is already in the regular
   *  pin set or no camp is selected. */
  navCampPin: { camp: Camp; x: number; y: number } | null;
  /** Nav-only pin for an art piece — same role as navCampPin but for
   *  the art star shape. */
  navArtPin: { art: Art; x: number; y: number } | null;
  /** Single-select target for art — fires when exactly one art piece
   *  is selected. Drives the same big-label / halo / ring / GPS-
   *  bearing rendering camps get. Mutually exclusive with `target`. */
  artTarget: {
    art: Art; x: number; y: number;
    mine: boolean; friends: string[];
    color: string;
  } | null;
  /** Parsed address for the single selected art piece. Null in
   *  multi mode or when no art selected. */
  artTargetAddress: {
    clockHour: number; radiusFeet: number;
    clock: string; street: string;
  } | null;
  /** Dynamic viewBox dimensions, expanded to fit the outermost
   *  pinned item (deep-playa art typically). Computed in MapView. */
  vbWidth: number;
  vbHeight: number;
  /** Effective ring-radius the viewBox is sized to (= half-vbWidth).
   *  Used by the playa-background circle. */
  vbRadius: number;
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
    kind: 'camp' | 'art' | 'mine' | 'friend' | 'poi';
    color: string;
  }>;
  poiPins: Array<{ poi: BrcPOI; x: number; y: number }>;
  zoom: number;
  center: { x: number; y: number };
  setCenter: (c: { x: number; y: number }) => void;
  /** Distance unit for the between-pins label (and any future readouts). */
  unit: DistanceUnit;
  /** Per-year BRC geometry derived from the active source. Threaded
   *  in from MapView so all the address-math + grid-rendering inside
   *  Svg uses the right year's Golden Spike + radii. */
  brc: BrcMapData;
}) {
  // Radial streets we draw: 2:00 through 10:00. The arc is NOT a full
  // circle — the 6:00 side is open to the playa.
  const radialHours = [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
  // viewBox derived from zoom + center. At zoom=1 this reproduces the
  // original `-6000 -3300 12000 9300` frame exactly (DEFAULT_CENTER is
  // the midpoint of that frame).
  const vbW = vbWidth / zoom;
  const vbH = vbHeight / zoom;
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
      <circle cx={0} cy={0} r={vbRadius * 0.98} class="brc-playa" />
      {/* Concentric letter streets, 2:00 → 10:00 through 6:00 (the
          city side). Polyline approximation — SVG's A-command flags
          for large-arc/sweep disambiguation render counter-intuitively
          with our y-inverted coord system, so we just iterate hour
          positions. Going through increasing hour from 2 to 10 traces
          3→4→…→9, which is the BRC-occupied arc. */}
      {brc.streetRadiiFeet.map((r, idx) => (
        <path
          key={idx}
          d={arcPolylinePath(2, 10, r)}
          class={'brc-street' + (idx === 0 ? ' esplanade' : '')}
          fill="none"
        />
      ))}
      {/* radial streets: line from Esplanade (inner) out to K (outer) */}
      {radialHours.map((h) => {
        const inner = hourToSvgPoint(h, brc.streetRadiiFeet[0]);
        const outer = hourToSvgPoint(h, brc.streetRadiiFeet[brc.streetRadiiFeet.length - 1]);
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
      <line x1={0} y1={0} x2={hourToSvgPoint(6, brc.streetRadiiFeet[0]).x} y2={hourToSvgPoint(6, brc.streetRadiiFeet[0]).y} class="brc-street axis" />
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
      {!target && artTarget && artTargetAddress && (
        <>
          {/* Art label parallel to camp target. Title prefixes with the
              palette glyph so it reads as "art" at a glance, plus
              artist when known. Address falls back to "<clock> at
              <feet>'" form for art in open playa (no street). */}
          <text
            x={0} y={-920}
            class="brc-label brc-address-title"
            text-anchor="middle"
          >
            🎨 {artTarget.art.name}
            {artTarget.art.artist ? ` — ${artTarget.art.artist}` : ''}
          </text>
          <text
            x={0} y={-460}
            class="brc-label brc-address-label"
            text-anchor="middle"
          >
            {/* Open Playa + Man Pavilion are the two synthetic
                "streets" the parser emits for the clock+distance art
                form — the city's letter rings (A-K) don't apply, so
                show clock + raw feet. Real letter streets keep the
                familiar "<clock> & <street>" form. */}
            {(artTargetAddress.street === 'Open Playa'
              || artTargetAddress.street === 'Man Pavilion')
              ? `${artTargetAddress.clock} · ${artTargetAddress.radiusFeet}'`
              : `${artTargetAddress.clock} & ${artTargetAddress.street}`}
          </text>
        </>
      )}
      {!target && !artTarget && activeSpot && activeSpotAddress && (
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
      {brc.streetLetters.map((letter, idx) => {
        const offset = idx === 0 ? 240 : 50;
        const r = brc.streetRadiiFeet[idx] + offset;
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
        const p = hourToSvgPoint(h, brc.streetRadiiFeet[brc.streetRadiiFeet.length - 1] + 350);
        return (
          <text key={h} x={p.x} y={p.y} class="brc-label hour-label" text-anchor="middle">
            {h}:00
          </text>
        );
      })}

      {/* Spot highlight — same radial + ring-arc + halo treatment as
          camp highlights, but recolored via `.brc-highlight.spot`
          CSS so the violet meet-spot palette reads instead of orange. */}
      {!target && !artTarget && activeSpot && activeSpotAddress && (() => {
        const outerR = brc.streetRadiiFeet[brc.streetRadiiFeet.length - 1] + 150;
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
        const outerR = brc.streetRadiiFeet[brc.streetRadiiFeet.length - 1] + 150;
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

      {/* Art single-select highlight — same radial + ring-arc + halo
          treatment as camps + meet-spots, recolored magenta to match
          the star pin's fill. The radial extends to the FURTHER of
          (K-street + 150) and (pin radius + 250) so deep-playa art
          (6000-10000') gets a line that actually reaches its pin
          instead of stopping at the city edge. `!target &&` prefix is
          defensive — `target` and `artTarget` are mutually exclusive
          by construction (selection.size==1 + key prefix). */}
      {!target && artTarget && artTargetAddress && (() => {
        const cityEdge = brc.streetRadiiFeet[brc.streetRadiiFeet.length - 1] + 150;
        const outerR = Math.max(cityEdge, artTargetAddress.radiusFeet + 250);
        const radialEnd = hourToSvgPoint(artTargetAddress.clockHour, outerR);
        const span = 0.6;
        const arcD = arcPolylinePath(
          artTargetAddress.clockHour - span,
          artTargetAddress.clockHour + span,
          artTargetAddress.radiusFeet,
          12,
        );
        return (
          <g
            class="brc-highlight"
            style={{ '--highlight-color': artTarget.color } as JSX.CSSProperties}
          >
            <line x1={0} y1={0} x2={radialEnd.x} y2={radialEnd.y} class="brc-highlight-radial" />
            <path d={arcD} class="brc-highlight-ring" fill="none" />
            <circle cx={artTarget.x} cy={artTarget.y} r={180} class="brc-highlight-halo" />
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
              it visually hugs the line without crossing it.

          Collision avoidance:
            - Items at similar clock-bearings would land their address
              labels on the same radial line — distribute them across
              [0.3, 0.7] of each item's distance instead of a fixed
              0.5 so the labels separate radially.
            - Items with dots close to each other in screen space
              would collide their NAME labels above the dot — stack
              the names vertically (the lower-screen dot keeps its
              label close, the upper-screen dot's label is pushed
              further up). */}
      {(() => {
        if (selectedItems.length < 2) return null;
        // 1. Bearing groups for radial address-label spreading.
        const BEARING_TOL = 0.5;   // clock-hours
        type BGroup = { hr: number; items: Array<{ key: string; radius: number }> };
        const bearingGroups: BGroup[] = [];
        const parsed = selectedItems.map((it) => ({ it, addr: parseAddress(it.address, brc) }));
        for (const p of parsed) {
          if (!p.addr) continue;
          let g = bearingGroups.find((bg) => Math.abs(bg.hr - p.addr!.clockHour) < BEARING_TOL);
          if (!g) { g = { hr: p.addr.clockHour, items: [] }; bearingGroups.push(g); }
          g.items.push({ key: p.it.key, radius: p.addr.radiusFeet });
        }
        const addrFracByKey = new Map<string, number>();
        for (const g of bearingGroups) {
          if (g.items.length === 1) {
            addrFracByKey.set(g.items[0].key, 0.5);
            continue;
          }
          // Closer-to-Man first → smaller fraction. Distribute across
          // [0.3, 0.7] of each item's own length.
          g.items.sort((x, y) => x.radius - y.radius);
          const lo = 0.3, hi = 0.7;
          for (let i = 0; i < g.items.length; i++) {
            const t = i / (g.items.length - 1);
            addrFracByKey.set(g.items[i].key, lo + t * (hi - lo));
          }
        }

        // 2. Screen-space clusters for name-label placement.
        // Two name labels visibly overlap whenever their X centers
        // are within roughly half-the-sum-of-widths AND Y centers
        // are within ~font height. Names vary widely in width, so
        // use generous tolerances and rely on the above/below
        // alternation below to separate clustered labels even when
        // they DO end up at the same Y after offsetting.
        const POS_TOL_X = 1800;
        const POS_TOL_Y = 600;
        const posClusters: Array<Array<{ key: string; x: number; y: number }>> = [];
        for (const it of selectedItems) {
          let c = posClusters.find((cl) => {
            // Match against any member of the cluster (transitive
            // closure) — handles A close to B, B close to C without
            // requiring A and C to also pass the test.
            return cl.some((m) =>
              Math.abs(m.x - it.x) < POS_TOL_X &&
              Math.abs(m.y - it.y) < POS_TOL_Y,
            );
          });
          if (!c) { c = []; posClusters.push(c); }
          c.push({ key: it.key, x: it.x, y: it.y });
        }
        const nameStackByKey = new Map<string, number>();
        for (const c of posClusters) {
          // Sort top-of-screen first (smallest y). The top dot keeps
          // its label ABOVE; the next dot's label flips BELOW; the
          // third goes further above; the fourth further below — even
          // indices alternate up, odd alternate down. This is the
          // only way to reliably separate two labels that share a Y
          // (purely vertical stacking would still leave them at the
          // same horizontal extent).
          c.sort((x, y) => x.y - y.y);
          for (let i = 0; i < c.length; i++) nameStackByKey.set(c[i].key, i);
        }

        // 3. Render — same per-item logic as before, but read the
        //    precomputed offsets instead of using fixed values.
        return selectedItems.map((item) => {
          const addr = parseAddress(item.address, brc);
          if (!addr) return null;
          // Radial extends to the further of city-edge and the pin's
          // own radius — same fix applied to single-select. Without
          // this, deep-playa art at radius > K would have its radial
          // line stop at K and never reach the actual pin.
          const cityEdge = brc.streetRadiiFeet[brc.streetRadiiFeet.length - 1] + 150;
          const outerR = Math.max(cityEdge, addr.radiusFeet + 250);
          const radialEnd = hourToSvgPoint(addr.clockHour, outerR);
          const span = 0.6;
          const arcD = arcPolylinePath(
            addr.clockHour - span, addr.clockHour + span,
            addr.radiusFeet, 12,
          );
          const cls = item.kind === 'camp' ? 'brc-highlight'
            : item.kind === 'poi' ? 'brc-highlight poi'
            : item.kind === 'art' ? 'brc-highlight art'
            : 'brc-highlight spot';
          const len = Math.hypot(item.x, item.y) || 1;
          const ux = item.x / len;
          const uy = item.y / len;
          const addrFrac = addrFracByKey.get(item.key) ?? 0.5;
          const addrR = len * addrFrac;
          let perpX = -uy;
          let perpY = ux;
          if (perpY > 0) { perpX = -perpX; perpY = -perpY; }
          const tinyOff = 50;
          const addrCx = ux * addrR + perpX * tinyOff;
          const addrCy = uy * addrR + perpY * tinyOff;
          let angle = (Math.atan2(item.y, item.x) * 180) / Math.PI;
          if (angle > 90 || angle < -90) angle += 180;
          const stackIdx = nameStackByKey.get(item.key) ?? 0;
          // Even index → above the dot (default), odd → below the
          // dot, with each pair pushed further out. Halo is r=180
          // and the name label baseline sits ~30 px above the
          // y-coordinate, so:
          //   above: dy = -220 (text spans roughly y-380 .. y-250)
          //   below: dy = +400 (text spans roughly y+220 .. y+350)
          // Both clear the halo with breathing room.
          const above = stackIdx % 2 === 0;
          const tier = Math.floor(stackIdx / 2);
          const nameDy = above
            ? -220 - tier * 200
            :  400 + tier * 200;
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
        });
      })()}

      {/* Pair-distance link. Only fires for exactly 2 selections —
          adding more would draw N(N-1)/2 segments that fight the
          radials for visual real estate. SVG coords are in feet
          centered on the Man, so Euclidean distance ≈ true ground
          distance at BRC scale (sub-mile, flat playa).

          Two layouts depending on how far apart the pins are:
          - Far apart: midpoint label rides along the segment.
          - Close (overlapping halos / name labels): push label out
            perpendicular to the segment with a leader line, so the
            number doesn't get sandwiched between the two dots and
            their own name labels. */}
      {selectedItems.length === 2 && (() => {
        const [a, b] = selectedItems;
        const dxFt = b.x - a.x;
        const dyFt = b.y - a.y;
        const segLen = Math.hypot(dxFt, dyFt);
        const meters = feetToMeters(segLen);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        // Threshold roughly = "halos overlap or come close enough
        // that the midpoint sits inside a name label." Halo r=180
        // each + name labels at dy=-220 means anything under ~700 ft
        // overlaps somewhere.
        const CLOSE_FT = 700;
        const closeMode = segLen < CLOSE_FT;
        let labelX = midX;
        let labelY = midY;
        let angle = 0;
        let dy = -40;
        if (closeMode) {
          // Perpendicular unit vector to the segment. Fall back to
          // straight-up when the two pins are essentially coincident.
          let perpX: number;
          let perpY: number;
          if (segLen < 1) { perpX = 0; perpY = -1; }
          else { perpX = -dyFt / segLen; perpY = dxFt / segLen; }
          // Pick the half-plane that points AWAY from the Man so the
          // label lands in open playa, not on top of the city's
          // grid+pin clutter on the inside.
          if (perpX * midX + perpY * midY < 0) {
            perpX = -perpX; perpY = -perpY;
          }
          const offset = 700;   // clears halo (r=180) + name band
          labelX = midX + perpX * offset;
          labelY = midY + perpY * offset;
          // Horizontal in close mode — no rotation gymnastics, the
          // leader line conveys the association.
          angle = 0;
          dy = 0;
        } else {
          // Rotate the label to ride along the line; flip if it
          // would read upside-down so it's always readable.
          angle = (Math.atan2(dyFt, dxFt) * 180) / Math.PI;
          if (angle > 90 || angle < -90) angle += 180;
        }
        return (
          <g class="brc-pair-distance" pointer-events="none">
            <line
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              class="brc-pair-line"
            />
            {closeMode && (
              <line
                x1={midX} y1={midY} x2={labelX} y2={labelY}
                class="brc-pair-leader"
              />
            )}
            <text
              transform={`translate(${labelX}, ${labelY}) rotate(${angle})`}
              dy={dy}
              text-anchor="middle"
              dominant-baseline={closeMode ? 'central' : 'auto'}
              class="brc-pair-label"
            >{formatDistance(meters, unit)}</text>
          </g>
        );
      })()}

      {/* Bearing line from user to single selection. Multi-select
          drops it — there's no clear "where am I going?" with N≥2.
          Color matches the target's dot so the line reads as an
          extension of the dot, not a separate visual layer. */}
      {userSvg && (target || artTarget || activeSpot) && (() => {
        const t =
          target ? { x: target.x, y: target.y, color: target.color }
          : artTarget ? { x: artTarget.x, y: artTarget.y, color: artTarget.color }
          : { x: activeSpot!.x, y: activeSpot!.y, color: activeSpot!.color };
        return (
          <line
            x1={userSvg.x} y1={userSvg.y}
            x2={t.x} y2={t.y}
            class="brc-bearing"
            style={{ '--highlight-color': t.color } as JSX.CSSProperties}
          />
        );
      })()}

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

      {/* Nav-target pin for an unstarred camp the user routed in to.
          Same circle shape as a regular pin so the size/position read
          consistently, but the `nav-target` modifier styles it as a
          dashed outline (CSS) — communicates "you're navigating here,
          you haven't starred this yet". */}
      {navCampPin && (
        <g
          class={'brc-pin nav-target active'}
          transform={`translate(${navCampPin.x} ${navCampPin.y})`}
          onClick={(e) => {
            e.stopPropagation();
            toggleKey(campKey(navCampPin.camp.id));
          }}
        >
          <circle r={150} class="brc-pin-hit" />
          <circle r={70} class="brc-pin-outer" />
          <circle r={35} class="brc-pin-inner" />
          <title>{navCampPin.camp.name}{navCampPin.camp.location ? ` — ${navCampPin.camp.location}` : ''}</title>
        </g>
      )}

      {/* Art pins — favorited art only. Star shape so the "art piece"
          affordance reads distinct from camps' circles + meet-spots'
          circles + my-camp's triangle. Tap toggles selection (matches
          camp pin behavior — sidebar row expands inline with details
          + an "Open art card →" button to jump to the Art tab). */}
      {artPins.map((p) => (
        <g
          key={`art-${p.art.id}`}
          class={
            'brc-art-pin'
            + (selection.has(artKey(p.art.id)) ? ' active' : '')
            + (p.mine ? ' mine' : ' friend')
          }
          transform={`translate(${p.x} ${p.y})`}
          onClick={(e) => {
            e.stopPropagation();
            toggleKey(artKey(p.art.id));
          }}
        >
          <circle r={150} class="brc-pin-hit" />
          {/* 5-point star — visually distinct from camp circles,
              meet-spot circles, and the my-camp triangle. Outer
              radius 70, inner ~27 (golden-ratio inset). */}
          <path
            d="M 0 -70 L 16 -22 L 67 -22 L 26 8 L 41 57 L 0 27 L -41 57 L -26 8 L -67 -22 L -16 -22 Z"
            class="brc-art-pin-body"
          />
          <title>
            🎨 {p.art.name}{p.art.artist ? ` — ${p.art.artist}` : ''}
            {p.art.location ? ` — ${p.art.location}` : ''}
          </title>
        </g>
      ))}

      {/* Nav-target star for an unstarred art piece the user routed
          in to. Mirrors navCampPin's role for camps. */}
      {navArtPin && (
        <g
          class={'brc-art-pin nav-target active'}
          transform={`translate(${navArtPin.x} ${navArtPin.y})`}
          onClick={(e) => {
            e.stopPropagation();
            toggleKey(artKey(navArtPin.art.id));
          }}
        >
          <circle r={150} class="brc-pin-hit" />
          <path
            d="M 0 -70 L 16 -22 L 67 -22 L 26 8 L 41 57 L 0 27 L -41 57 L -26 8 L -67 -22 L -16 -22 Z"
            class="brc-art-pin-body"
          />
          <title>
            🎨 {navArtPin.art.name}{navArtPin.art.artist ? ` — ${navArtPin.art.artist}` : ''}
            {navArtPin.art.location ? ` — ${navArtPin.art.location}` : ''}
          </title>
        </g>
      )}

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
