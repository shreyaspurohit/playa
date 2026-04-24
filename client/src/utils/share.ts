// Encode/decode share URLs. Fragment-only (`#share=…`) so the payload
// never leaves the device — GitHub Pages servers don't see fragments.
//
// Encoded form: base64url(JSON.stringify({
//   n: nickname, c: [camp ids], e: [event ids],
//   m: myCampId?, s: [meetSpots]?,
// })).
// Base64url avoids `+` / `/` / `=` that mail clients + SMS mangle.
//
// Decode is ADVERSARIAL: a share URL is user-supplied input from an
// untrusted source. `decodeShare` caps input size (DoS), rejects
// prototype sentinels (object pollution via `friends[name]` lookup),
// drops control/bidi chars from the nickname (UI spoofing), and
// strict-validates every id + meet-spot entry (so nothing weird ends
// up in a URL, a DOM query, or localStorage).

import type { MeetSpot } from '../types';

export interface SharePayload {
  name: string;
  campIds: string[];
  eventIds: string[];
  /** Sender's home camp id, if they marked one. Always validated as a
   *  normal id (alphanumeric + - _), so even if a malicious sender
   *  stuffs something weird in here the receiver safely ignores it. */
  myCampId?: string;
  /** Rendezvous plans. Drops gracefully to empty when the shape is off. */
  meetSpots?: MeetSpot[];
}

// === Validation limits + allow/deny lists ============================

/** Max length of the base64url payload before we bother decoding. At
 *  200 KB we're well under browser URL limits and well past any
 *  realistic "user shared their whole fav list" case (~5700 IDs × a
 *  few chars each = ~40 KB base64). */
export const MAX_ENCODED_LEN = 200_000;
/** Cap on the displayed nickname. Fits in all our chip/banner layouts.
 *  Also bounds a DoS vector where someone sends a 10 MB name. */
export const MAX_NICKNAME_LEN = 64;
/** Per-list cap on id count. Real directory ~ 1500 camps + ~4200 events.
 *  2000 is a generous headroom; past that it's junk or an attack. */
export const MAX_IDS = 2000;
/** Per-id cap. Directory uses short numeric ids; 64 allows future
 *  SFDC-style uids from the official API without being unbounded. */
export const MAX_ID_LEN = 64;
/** Reasonable ceilings for the rendezvous layer. */
export const MAX_MEET_SPOTS = 50;
export const MAX_MEET_LABEL_LEN = 80;
export const MAX_MEET_ADDRESS_LEN = 40;
export const MAX_MEET_WHEN_LEN = 40;

/** Reject anything that would make the nickname invisible, reorder
 *  adjacent text, or impersonate other strings:
 *   - C0/C1 controls (0x00–0x1F, 0x7F–0x9F)
 *   - zero-width joiners/spaces (0x200B–0x200F)
 *   - bidi overrides (0x202A–0x202E, 0x2066–0x2069)
 *   - BOM (0xFEFF) */
const BAD_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;
/** Nicknames that would pollute the friends map via `friends[name]`
 *  property lookup on a plain object. We use these as bag keys in
 *  `useFriends`, so a name of `__proto__` would walk up the prototype
 *  chain on read. Banning is simpler than rewriting the hook to use
 *  `Object.create(null)` or Map everywhere. */
const BANNED_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

/** IDs must be short and printable. Directory IDs are numeric; official
 *  API uids are alphanumeric with hyphens. Anything else (whitespace,
 *  quotes, angle brackets, path separators) has no business here. */
const ID_RE = /^[A-Za-z0-9_-]+$/;

function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_NICKNAME_LEN) return null;
  if (BAD_CHARS.test(trimmed)) return null;
  if (BANNED_NAMES.has(trimmed)) return null;
  return trimmed;
}

/** Validate a single meet-spot entry. Drops the whole entry on any
 *  shape violation — no partial/empty rescue, because a missing label
 *  or address would render as a nameless pin on the receiver's map. */
function cleanMeetSpot(raw: unknown): MeetSpot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { label?: unknown; address?: unknown; when?: unknown };
  if (typeof r.label !== 'string' || typeof r.address !== 'string') return null;
  // Reject control/bidi chars in the label (same rules as nickname).
  if (BAD_CHARS.test(r.label)) return null;
  const label = r.label.trim().slice(0, MAX_MEET_LABEL_LEN);
  const address = r.address.trim().slice(0, MAX_MEET_ADDRESS_LEN);
  if (!label || !address) return null;
  const when = typeof r.when === 'string'
    ? r.when.trim().slice(0, MAX_MEET_WHEN_LEN) || undefined
    : undefined;
  return { label, address, ...(when ? { when } : {}) };
}

function cleanMeetSpots(raw: unknown): MeetSpot[] {
  if (!Array.isArray(raw) || raw.length > MAX_MEET_SPOTS) return [];
  const out: MeetSpot[] = [];
  for (const v of raw) {
    const spot = cleanMeetSpot(v);
    if (spot) out.push(spot);
  }
  return out;
}

/** Pick a single camp id out of a possibly-garbage value. Returns `""`
 *  (not undefined) when invalid — callers treat empty-string as "unset". */
function cleanSingleId(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s || s.length > MAX_ID_LEN) return '';
  if (!ID_RE.test(s)) return '';
  return s;
}

function cleanIds(raw: unknown): string[] {
  // Whole-list reject: > MAX_IDS is almost certainly an attack or junk.
  // Dropping the outliers individually would still leave MAX_IDS "real"
  // items, which lets the attack succeed partially. Reject everything.
  if (!Array.isArray(raw) || raw.length > MAX_IDS) return [];
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

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeShare(p: SharePayload): string {
  // Compact field names keep URLs short. Optional rendezvous fields
  // are omitted entirely when empty so a share with just favorites
  // stays byte-identical to the pre-rendezvous format.
  const compact: {
    n: string; c: string[]; e: string[];
    m?: string; s?: MeetSpot[];
  } = { n: p.name, c: p.campIds, e: p.eventIds };
  if (p.myCampId) compact.m = p.myCampId;
  if (p.meetSpots && p.meetSpots.length > 0) compact.s = p.meetSpots;
  const json = JSON.stringify(compact);
  return toBase64Url(new TextEncoder().encode(json));
}

export function decodeShare(encoded: string): SharePayload | null {
  if (typeof encoded !== 'string' || !encoded) return null;
  // Cap BEFORE decode — don't waste cycles base64-decoding a DoS payload.
  if (encoded.length > MAX_ENCODED_LEN) return null;
  try {
    const json = new TextDecoder().decode(fromBase64Url(encoded));
    const parsed = JSON.parse(json);
    // Reject arrays and primitives — only plain object envelopes.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const name = cleanName((parsed as { n?: unknown }).n);
    if (!name) return null;
    const campIds = cleanIds((parsed as { c?: unknown }).c);
    const eventIds = cleanIds((parsed as { e?: unknown }).e);
    const myCampId = cleanSingleId((parsed as { m?: unknown }).m);
    const meetSpots = cleanMeetSpots((parsed as { s?: unknown }).s);
    return {
      name, campIds, eventIds,
      ...(myCampId ? { myCampId } : {}),
      ...(meetSpots.length > 0 ? { meetSpots } : {}),
    };
  } catch {
    return null;
  }
}

/** Build a shareable URL to the current site. Uses the fragment so the
 * payload stays client-side (Pages server never sees it). */
export function buildShareUrl(payload: SharePayload): string {
  const base = location.origin + location.pathname;
  return `${base}#share=${encodeShare(payload)}`;
}

/** If the current URL carries a `#share=…` payload, return it. */
export function readShareFromUrl(): SharePayload | null {
  const frag = location.hash;
  const m = frag.match(/[#&]share=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  return decodeShare(m[1]);
}

/** Remove the share param from the URL after processing, without
 * reloading the page. */
export function clearShareFromUrl(): void {
  const frag = location.hash.replace(/[#&]share=[^&]*/, '');
  const clean = frag.replace(/^#&/, '#').replace(/^#$/, '');
  history.replaceState(null, '', location.pathname + location.search + clean);
}

/** Clipboard write. Returns true on success. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback: the old execCommand('copy') path. Works in older Safari.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
