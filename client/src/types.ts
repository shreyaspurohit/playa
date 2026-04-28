// Shape of the JSON embedded by the Python builder. Kept in sync with
// backend/src/playa/models.py (Camp.to_dict / Event.to_dict).

export interface ParsedTime {
  kind: 'single' | 'recurring';
  days: string[];                // ['Mon', ...]
  start_day: string | null;
  start_date: string | null;     // 'M/D' when known (enriched from week_map)
  start_time: string;            // 'HH:MM' 24h
  end_day: string | null;
  end_date: string | null;
  end_time: string;
}

export interface Event {
  id: string;
  name: string;
  description: string;
  time: string;                   // raw directory text
  display_time: string;           // pre-parsed clean form; '' if unparseable
  parsed_time: ParsedTime | null; // structured form for the calendar
}

export interface Camp {
  id: string;
  name: string;
  location: string;
  description: string;
  website: string;
  url: string;                    // canonical /camps/<id>/
  tags: string[];
  events: Event[];
}

export interface EncryptedPayload {
  salt: string;                   // base64
  iter: number;                   // PBKDF2 iterations
  ct: string;                     // base64 ciphertext
}

// LocalStorage keys — declared here so any refactor touches one place.
export const LS = {
  theme:     'bm-theme',
  infoSeen:  'bm-info-seen',
  favs:      'bm-favs',
  favEvents: 'bm-fav-events',
  nickname:  'bm-nickname',       // your display name for sharing
  sharedFavs:'bm-shared',         // {[friendName]: FriendFavs}
  viewMode:  'bm-view',           // 'camps' | 'schedule' | 'map' (last tab)
  // Per-day hides for recurring events in the Schedule view. Backed by
  // the same Set shape as favorites. Keys are composite:
  // `${eventId}|${iso}` (e.g., "779|2026-08-27"). Lets a user keep an
  // event starred but opt out of specific days it recurs on.
  hiddenDays: 'bm-hidden-days',
  // Rendezvous layer — the user's own home camp (single id) and
  // self-authored meet spots (label + address + optional time). Both
  // piggyback on the share link so friends who import your list also
  // learn where to find you and where you plan to be.
  myCampId:  'bm-my-camp',         // single camp id or empty
  meetSpots: 'bm-meet-spots',      // JSON array of MeetSpot
  // One-shot flag set the first time we reconcile legacy starred events
  // into starred camps (so every event-star auto-stars its camp). After
  // that, the rule applies only to new event-star transitions, and the
  // user can un-star an auto-added camp without it being re-starred on
  // next load.
  eventCampReconciled: 'bm-event-camp-reconciled',
  // Cached unlock password. Lives in localStorage (not sessionStorage)
  // so mobile browsers don't drop it when they reclaim a backgrounded
  // tab — that's the difference between "stays signed in like a real
  // app" and "re-prompts every time you switch apps". Cleared by
  // "Clear all local data" in the About modal.
  password:  'bm-pw',
  // ISO timestamp of the most recent release-note this user has seen.
  // Anything in the embedded notes list with a later `ts` lights up
  // the release-notes banner.
  releaseNotesSeen: 'bm-rn-seen',
  // Map distance preference — 'imperial' (mi/ft) or 'metric' (km/m).
  // Drives the between-pins distance label, the per-row nav distance,
  // and any future distance readout. Default 'imperial' (US-centric burn).
  distanceUnit: 'bm-distance-unit',
} as const;

/** Compat shim — older builds wrote the password to sessionStorage
 *  under this key. The Gate reads it on boot and migrates the value
 *  into LS.password, then clears the old slot. After everyone has
 *  loaded a build that's seen this code at least once, this can go. */
export const SS = {
  password:  'bm-pw',
} as const;

/** One friend's imported favorites. Stored as plain arrays (not Sets)
 * so JSON round-trip is trivial. */
export interface FriendFavs {
  name: string;
  campIds: string[];
  eventIds: string[];
  importedAt: string;             // ISO timestamp
  myCampId?: string;              // their home camp, if they shared it
  meetSpots?: MeetSpot[];         // rendezvous plans, if they shared any
}

/** One pre-planned rendezvous: a human label ("Temple at sunset"), a
 *  BRC address the client can render on the map, and an optional
 *  free-form "when" (no parse required — users write whatever they
 *  want). Same shape for the user's own list and for friends'. */
export interface MeetSpot {
  label: string;                  // e.g., "Temple at sunset"
  address: string;                // e.g., "12:00 & Esplanade"
  when?: string;                  // free-form; "Wed 9pm"
}
