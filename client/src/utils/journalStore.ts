// Offline journal store — pure model + merge + validation (ADR 20).
//
// The persisted shape is one `JournalEntry` per `entryId`: the single current
// value, or a tombstone. There is no version history — an edit overwrites the
// record in place and a delete removes it (D2/D10). Merge is a per-entry
// last-write-wins register with permanent tombstones: a proper CRDT join, so it
// is order-independent and idempotent with no version vectors, content hashes,
// or device identities.
//
// This module is deliberately free of IndexedDB and DOM access so the merge and
// validation logic is unit-testable in node (mirrors utils/syncDoc.ts). The
// IndexedDB persistence layer wraps these functions.

import type {
  JournalContext, JournalContextKind, JournalDocument, JournalEntry, JournalEntryValue,
} from '../types';

export const JOURNAL_SCHEMA = 'playa-journal-v1';
export const MAX_JOURNAL_BYTES = 10_000_000;   // 10 MB encoded-document cap
export const MAX_ENTRIES = 10_000;
export const MAX_TEXT_BYTES = 20 * 1024;       // 20 KiB UTF-8 per entry
export const MAX_TITLE = 200;                  // single-line heading
export const MAX_CONTEXT_FIELD = 300;
export const MIN_BURN_YEAR = 2000;
export const MAX_BURN_YEAR = 2100;

const CONTEXT_KINDS = new Set<JournalContextKind>(['camp', 'event', 'food', 'art']);

// ---- Delight layer (ADR 20 D18) ----------------------------------------

/** Curated, playa-flavored moods — expressive vibes, not a happy-scale of
 *  faces. `mood` stores the key; the emoji/label are a rendering detail. */
export interface MoodOption { key: string; emoji: string; label: string; }
export const MOODS: MoodOption[] = [
  { key: 'grateful', emoji: '🙏', label: 'Grateful' },
  { key: 'energized', emoji: '⚡', label: 'Energized' },
  { key: 'blissful', emoji: '🌸', label: 'Blissful' },
  { key: 'awestruck', emoji: '🌠', label: 'Awestruck' },
  { key: 'dusty', emoji: '🌵', label: 'Dusty' },
  { key: 'connected', emoji: '🫶', label: 'Connected' },
  { key: 'reflective', emoji: '🕯️', label: 'Reflective' },
  { key: 'euphoric', emoji: '💫', label: 'Euphoric' },
  { key: 'peaceful', emoji: '🧘', label: 'Peaceful' },
  { key: 'overwhelmed', emoji: '🌊', label: 'Overwhelmed' },
  { key: 'inspired', emoji: '✨', label: 'Inspired' },
  { key: 'playful', emoji: '🎉', label: 'Playful' },
  { key: 'wild', emoji: '🔥', label: 'Wild' },
  { key: 'tender', emoji: '💗', label: 'Tender' },
  { key: 'exhausted', emoji: '😴', label: 'Exhausted' },
  { key: 'curious', emoji: '🔭', label: 'Curious' },
];
const MOOD_KEYS = new Set(MOODS.map((m) => m.key));
export function moodOption(key: string | undefined): MoodOption | undefined {
  return key ? MOODS.find((m) => m.key === key) : undefined;
}

export type TimeOfDay = 'dawn' | 'morning' | 'afternoon' | 'dusk' | 'night';
/** Pure bucket from a 24h hour. Night wraps midnight (20–5). */
export function timeOfDayBucket(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 20) return 'dusk';
  return 'night';
}
/** Bucket from an `occurredAt` string ('YYYY-MM-DDTHH:mm'). */
export function timeOfDayFor(occurredAt: string): TimeOfDay {
  const hh = parseInt(occurredAt.slice(11, 13), 10);
  return timeOfDayBucket(Number.isFinite(hh) ? hh : 12);
}
const BANNED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Exact minute-resolution BRC wall time. Real-calendar validity checked separately.
const OCCURRED_AT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

// Reject control (C0/C1), bidi-override, and zero-width characters — the same
// class the other user-importable state (syncDoc) rejects. Checked by code point
// so the source carries no literal control characters. Context fields are
// single-line and reject newlines too; entry text keeps \t (9), \n (10), \r (13).
function hasBadChar(value: string, allowNewlines: boolean): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (allowNewlines && (c === 9 || c === 10 || c === 13)) continue;
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return true;    // C0 / DEL / C1
    if (c >= 0x200b && c <= 0x200f) return true;                // zero-width / marks
    if (c >= 0x202a && c <= 0x202e) return true;                // bidi embeddings/overrides
    if (c >= 0x2066 && c <= 0x2069) return true;                // bidi isolates
    if (c === 0xfeff) return true;                              // BOM / ZWNBSP
  }
  return false;
}

function dict<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

const encoder = new TextEncoder();
function utf8Bytes(value: string): number {
  return encoder.encode(value).length;
}

// Timestamps are ms since epoch. Bound them to a plausible window (D13) so a
// corrupted or hostile import can't pin an entry's Lamport clock at a value that
// both beats every future local edit and exceeds 2^53 — past which `knownMax+1`
// stops advancing and `nextModifiedAt` can no longer make a fresh save win.
// Year 2100 is far beyond any real burn yet well under Number.MAX_SAFE_INTEGER.
export const MAX_PLAUSIBLE_STAMP = Date.UTC(2100, 0, 1);   // 4102444800000

function finiteStamp(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
  const v = Math.floor(raw);
  return v <= MAX_PLAUSIBLE_STAMP ? v : null;
}

/** A fresh random write token; the deterministic tie-break on equal modifiedAt. */
export function newWriteToken(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `w-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

export function newEntryId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `e-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/** Lamport-style clock so a new save always becomes current, even if an
 *  observed device clock ran ahead of the local one. */
export function nextModifiedAt(knownMax: number, now = Date.now()): number {
  return Math.max(now, knownMax + 1);
}

export function greatestModifiedAt(entries: Iterable<JournalEntry>): number {
  let max = 0;
  for (const entry of entries) if (entry.modifiedAt > max) max = entry.modifiedAt;
  return max;
}

export function emptyJournalDocument(): JournalDocument {
  return { schema: JOURNAL_SCHEMA, entries: dict() };
}

/**
 * Per-entry last-write-wins winner (ADR 20 D10):
 *  1. a tombstone wins permanently over any upsert;
 *  2. otherwise the greater `(modifiedAt, writeToken)` wins.
 * Strict total order: `writeToken` is unique per save, so there is never a tie.
 */
export function pickEntry(a?: JournalEntry, b?: JournalEntry): JournalEntry | undefined {
  if (!a) return b;
  if (!b) return a;
  const aDel = a.deleted === 1;
  const bDel = b.deleted === 1;
  if (aDel !== bDel) return aDel ? a : b;               // a tombstone wins permanently
  if (a.modifiedAt !== b.modifiedAt) return a.modifiedAt > b.modifiedAt ? a : b;
  return a.writeToken >= b.writeToken ? a : b;          // deterministic tie-break
}

/** Commutative, associative, idempotent per-entry LWW merge. */
export function mergeDocuments(a: JournalDocument, b: JournalDocument): JournalDocument {
  const out = emptyJournalDocument();
  for (const id of new Set([...Object.keys(a.entries), ...Object.keys(b.entries)])) {
    const winner = pickEntry(a.entries[id], b.entries[id]);
    if (winner) out.entries[id] = winner;
  }
  return out;
}

/** Live (non-deleted) entries only. */
export function activeEntries(doc: JournalDocument): JournalEntry[] {
  return Object.values(doc.entries).filter((entry) => entry.deleted !== 1 && entry.value);
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort()
    .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}

export function documentsEqual(a: JournalDocument, b: JournalDocument): boolean {
  return stable(a) === stable(b);
}

function isRealCalendarDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Validate a minute-resolution BRC wall-time string with a real calendar date. */
export function validOccurredAt(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const match = OCCURRED_AT_RE.exec(raw);
  if (!match) return false;
  const [, y, m, d, hh, mm] = match.map(Number);
  return isRealCalendarDate(y, m, d) && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

function cleanContextField(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_CONTEXT_FIELD || hasBadChar(trimmed, false)) return null;
  if (BANNED_KEYS.has(trimmed)) return null;
  return trimmed;
}

function cleanContext(raw: unknown): JournalContext | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.kind !== 'string' || !CONTEXT_KINDS.has(row.kind as JournalContextKind)) return null;
  const title = cleanContextField(row.title);
  if (!title) return null;
  if (row.campName !== undefined) {
    const campName = cleanContextField(row.campName);
    if (!campName) return null;
    return { kind: row.kind as JournalContextKind, title, campName };
  }
  return { kind: row.kind as JournalContextKind, title };
}

/**
 * Validate an entry value (D3/D13). Returns a normalized copy or null. Entry
 * text preserves the user's newlines/spacing but is rejected if it carries
 * control/bidi characters or exceeds the 20 KiB cap; empty-after-trim is null.
 */
export function cleanEntryValue(raw: unknown): JournalEntryValue | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;

  if (typeof row.burnYear !== 'number' || !Number.isInteger(row.burnYear)
    || row.burnYear < MIN_BURN_YEAR || row.burnYear > MAX_BURN_YEAR) return null;
  if (!validOccurredAt(row.occurredAt)) return null;
  const createdAt = finiteStamp(row.createdAt);
  if (createdAt === null) return null;
  if (typeof row.text !== 'string' || !row.text.trim()
    || hasBadChar(row.text, true) || utf8Bytes(row.text) > MAX_TEXT_BYTES) return null;

  // Optional single-line title; empty-after-trim is treated as absent.
  let title: string | undefined;
  if (row.title !== undefined) {
    if (typeof row.title !== 'string') return null;
    const trimmed = row.title.trim();
    if (trimmed) {
      if (trimmed.length > MAX_TITLE || hasBadChar(trimmed, false)) return null;
      title = trimmed;
    }
  }

  // Optional mood — must be a known key (D13 allowlist), never arbitrary text.
  let mood: string | undefined;
  if (row.mood !== undefined) {
    if (typeof row.mood !== 'string' || !MOOD_KEYS.has(row.mood)) return null;
    mood = row.mood;
  }

  let context: JournalContext | undefined;
  if (row.context !== undefined) {
    const cleaned = cleanContext(row.context);
    if (!cleaned) return null;
    context = cleaned;
  }

  return {
    burnYear: row.burnYear,
    occurredAt: row.occurredAt as string,
    createdAt,
    ...(title ? { title } : {}),
    text: row.text,
    ...(mood ? { mood } : {}),
    ...(context ? { context } : {}),
  };
}

/** Validate a single `JournalEntry` record (its map key must equal entryId). */
function cleanEntry(id: string, raw: unknown): JournalEntry | null {
  if (BANNED_KEYS.has(id) || !UUID_RE.test(id)) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (row.entryId !== id) return null;
  const modifiedAt = finiteStamp(row.modifiedAt);
  if (modifiedAt === null) return null;
  if (typeof row.writeToken !== 'string' || !UUID_RE.test(row.writeToken)) return null;

  if (row.deleted !== undefined) {
    // Tombstone: exactly `deleted: 1`, never a value.
    if (row.deleted !== 1 || row.value !== undefined) return null;
    return { entryId: id, modifiedAt, writeToken: row.writeToken, deleted: 1 };
  }
  const value = cleanEntryValue(row.value);
  if (!value) return null;
  return { entryId: id, modifiedAt, writeToken: row.writeToken, value };
}

/**
 * Strict validation of the untrusted Dropbox document — also the exact path an
 * imported recovery file runs through (D13). Returns null on any violation so
 * the caller aborts the merge without mutating local data.
 */
export function parseJournalDocument(text: string): JournalDocument | null {
  if (!text || text.length > MAX_JOURNAL_BYTES) return null;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const root = raw as Record<string, unknown>;
  if (root.schema !== JOURNAL_SCHEMA) return null;
  if (!root.entries || typeof root.entries !== 'object' || Array.isArray(root.entries)) return null;

  const rows = Object.entries(root.entries as Record<string, unknown>);
  if (rows.length > MAX_ENTRIES) return null;
  const out = emptyJournalDocument();
  for (const [id, candidate] of rows) {
    const entry = cleanEntry(id, candidate);
    if (!entry) return null;
    out.entries[id] = entry;
  }
  return out;
}

export function serializeJournalDocument(doc: JournalDocument): string {
  return JSON.stringify(doc);
}
