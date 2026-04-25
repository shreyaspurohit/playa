// Cross-device snapshot: download / upload all of the user's local
// state as a JSON file. Lets you set up favorites + meet spots + my-camp
// + friends on one device, save the snapshot, and pick up where you
// left off on another (the share-link `#share=…` path covers a subset
// — favorites + rendezvous — but not hiddenDays or imported friends.)
//
// Validation here is adversarial: a JSON file is untrusted input
// (could come from anywhere). We re-use share.ts's primitives where
// they apply (BAD_CHARS, ID_RE, length caps), and add per-key shape
// checks for hiddenDays + the friends map.

import type { FriendFavs, MeetSpot } from '../types';
import { LS } from '../types';
import { readString, writeString } from './storage';

/** Bumped any time the on-disk format changes incompatibly. We accept
 *  the current version + a small whitelist of known older ones (none
 *  yet) and reject anything else with a clear message. */
export const SNAPSHOT_SCHEMA = 'playa-camps-v1';

/** Cap for total snapshot text size. Generous (5 MB) — even a fully
 *  packed user with 500 friends + 5000 stars + 50 spots stays well
 *  under this. Past it, we're looking at junk or an attack. */
const MAX_SNAPSHOT_BYTES = 5_000_000;

/** Per-key caps. Kept in lockstep with share.ts so a snapshot can't
 *  smuggle in something a share link would reject. */
const MAX_NICKNAME_LEN = 64;
const MAX_IDS = 5000;       // higher than share's 2000: snapshot is your own data
const MAX_ID_LEN = 64;
const MAX_MEET_SPOTS = 50;
const MAX_MEET_LABEL_LEN = 80;
const MAX_MEET_ADDRESS_LEN = 40;
const MAX_MEET_WHEN_LEN = 40;
const MAX_HIDDEN_DAYS = 5000;
const MAX_FRIENDS = 200;

/** Same character set rejected by share.ts: controls, zero-width,
 *  bidi overrides, BOM. */
const BAD_CHARS = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]');
const BANNED_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const ID_RE = /^[A-Za-z0-9_-]+$/;
/** hiddenDays keys are `${eventId}|${YYYY-MM-DD}` — see App.tsx. */
const HIDDEN_DAY_RE = /^[A-Za-z0-9_-]+\|\d{4}-\d{2}-\d{2}$/;

/** Full snapshot — the JSON written + read by export/import. */
export interface Snapshot {
  schema: typeof SNAPSHOT_SCHEMA;
  exportedAt: string;             // ISO-8601 UTC
  nickname: string;               // empty string if user never set one
  campFavs: string[];
  eventFavs: string[];
  myCampId: string;               // '' when unset
  meetSpots: MeetSpot[];
  hiddenDays: string[];           // composite "id|YYYY-MM-DD" keys
  friends: Record<string, FriendFavs>;
}

// === Validation helpers ==============================================

function cleanString(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  if (raw.length > max) return null;
  if (BAD_CHARS.test(raw)) return null;
  return raw;
}

function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const t = raw.trim();
  if (!t || t.length > MAX_NICKNAME_LEN) return '';
  if (BAD_CHARS.test(t)) return '';
  if (BANNED_NAMES.has(t)) return '';
  return t;
}

function cleanIds(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw) || raw.length > max) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v : '';
    if (!s || s.length > MAX_ID_LEN) continue;
    if (!ID_RE.test(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function cleanSingleId(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s || s.length > MAX_ID_LEN) return '';
  return ID_RE.test(s) ? s : '';
}

function cleanMeetSpots(raw: unknown): MeetSpot[] {
  if (!Array.isArray(raw) || raw.length > MAX_MEET_SPOTS) return [];
  const out: MeetSpot[] = [];
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue;
    const r = v as { label?: unknown; address?: unknown; when?: unknown };
    const label = cleanString(r.label, MAX_MEET_LABEL_LEN)?.trim();
    const address = cleanString(r.address, MAX_MEET_ADDRESS_LEN)?.trim();
    if (!label || !address) continue;
    const whenRaw = cleanString(r.when, MAX_MEET_WHEN_LEN);
    const when = whenRaw ? whenRaw.trim() : '';
    out.push({ label, address, ...(when ? { when } : {}) });
  }
  return out;
}

function cleanHiddenDays(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > MAX_HIDDEN_DAYS) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== 'string' || v.length > MAX_ID_LEN + 12) continue;
    if (!HIDDEN_DAY_RE.test(v)) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function cleanFriends(raw: unknown): Record<string, FriendFavs> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_FRIENDS) return {};
  const out: Record<string, FriendFavs> = {};
  for (const [k, v] of entries) {
    const name = cleanName(k);
    if (!name) continue;
    if (!v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    const friend: FriendFavs = {
      name,
      campIds: cleanIds(r.campIds, MAX_IDS),
      eventIds: cleanIds(r.eventIds, MAX_IDS),
      importedAt: typeof r.importedAt === 'string' && r.importedAt.length <= 32
        ? r.importedAt
        : new Date().toISOString(),
    };
    const myCampId = cleanSingleId(r.myCampId);
    if (myCampId) friend.myCampId = myCampId;
    const meetSpots = cleanMeetSpots(r.meetSpots);
    if (meetSpots.length > 0) friend.meetSpots = meetSpots;
    out[name] = friend;
  }
  return out;
}

// === Build / parse / apply ============================================

/** Read all relevant LS keys and return a Snapshot ready to JSON-encode. */
export function buildSnapshot(): Snapshot {
  const nickname = readString(LS.nickname, '');
  const campFavs = parseStringArray(readString(LS.favs, ''));
  const eventFavs = parseStringArray(readString(LS.favEvents, ''));
  const myCampId = readString(LS.myCampId, '');
  const meetSpots = parseMeetSpots(readString(LS.meetSpots, ''));
  const hiddenDays = parseStringArray(readString(LS.hiddenDays, ''));
  const friends = parseFriendsMap(readString(LS.sharedFavs, ''));
  return {
    schema: SNAPSHOT_SCHEMA,
    exportedAt: new Date().toISOString(),
    nickname,
    campFavs,
    eventFavs,
    myCampId,
    meetSpots,
    hiddenDays,
    friends,
  };
}

function parseStringArray(s: string): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

function parseMeetSpots(s: string): MeetSpot[] {
  if (!s) return [];
  try {
    return cleanMeetSpots(JSON.parse(s));
  } catch { return []; }
}

function parseFriendsMap(s: string): Record<string, FriendFavs> {
  if (!s) return {};
  try {
    return cleanFriends(JSON.parse(s));
  } catch { return {}; }
}

/**
 * Validate untrusted JSON text → Snapshot, or null on any structural
 * problem. Schema mismatch is a hard reject (we don't try to migrate
 * future formats — better to fail loud than silently drop fields).
 */
export function parseSnapshot(text: string): Snapshot | null {
  if (!text || text.length > MAX_SNAPSHOT_BYTES) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const r = parsed as Record<string, unknown>;
  if (r.schema !== SNAPSHOT_SCHEMA) return null;
  return {
    schema: SNAPSHOT_SCHEMA,
    exportedAt: typeof r.exportedAt === 'string' && r.exportedAt.length <= 32
      ? r.exportedAt
      : new Date().toISOString(),
    nickname: cleanName(r.nickname),
    campFavs: cleanIds(r.campFavs, MAX_IDS),
    eventFavs: cleanIds(r.eventFavs, MAX_IDS),
    myCampId: cleanSingleId(r.myCampId),
    meetSpots: cleanMeetSpots(r.meetSpots),
    hiddenDays: cleanHiddenDays(r.hiddenDays),
    friends: cleanFriends(r.friends),
  };
}

/**
 * Write the snapshot to localStorage, replacing the user's own state.
 * Caller is expected to `location.reload()` afterward — hooks read
 * their initial state from LS on mount, so a reload is the simplest
 * way to surface the change without per-hook bulk setters.
 */
export function applySnapshot(snap: Snapshot): void {
  writeString(LS.nickname, snap.nickname);
  writeString(LS.favs, JSON.stringify(snap.campFavs));
  writeString(LS.favEvents, JSON.stringify(snap.eventFavs));
  writeString(LS.myCampId, snap.myCampId);
  writeString(LS.meetSpots, JSON.stringify(snap.meetSpots));
  writeString(LS.hiddenDays, JSON.stringify(snap.hiddenDays));
  writeString(LS.sharedFavs, JSON.stringify(snap.friends));
}

// === IO helpers (browser only) =======================================

/** Trigger a file download for the snapshot. Filename includes the
 *  date + nickname so multiple exports are distinguishable. */
export function downloadSnapshot(snap: Snapshot): void {
  const blob = new Blob([JSON.stringify(snap, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const date = snap.exportedAt.slice(0, 10);
  const slug = (snap.nickname || 'anon').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  a.download = `playa-camps-${slug}-${date}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revocation: some browsers race the click handler.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Open a file picker, read the chosen JSON, return the parsed
 *  Snapshot or null on cancel/invalid. */
export function pickSnapshotFile(): Promise<Snapshot | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      try {
        const text = await file.text();
        resolve(parseSnapshot(text));
      } catch {
        resolve(null);
      }
    };
    // Safari needs the input attached to fire the picker reliably.
    input.style.display = 'none';
    document.body.appendChild(input);
    input.click();
    setTimeout(() => document.body.removeChild(input), 0);
  });
}
