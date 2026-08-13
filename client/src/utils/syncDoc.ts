// Provider-independent cloud-sync document and merge engine (ADR 16).
//
// Local UI hooks remain Set/localStorage based. A saved baseline records the
// last successfully merged document, allowing this layer to distinguish an
// intentional removal from a fresh device that simply has no local data yet.

import type { FriendFavs, MeetSpot, Source } from '../types';
import { LS, scopedKey } from '../types';

export const SYNC_SCHEMA = 'playa-sync-v1';
export const MAX_SYNC_BYTES = 5_000_000;
export const TOMBSTONE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

const MAX_DOC_KEYS = 500;
const MAX_SET_ITEMS = 10_000;
const MAX_ID_LEN = 128;
const SOURCE_RE = /^[A-Za-z0-9._-]{1,64}$/;
const ID_RE = /^[A-Za-z0-9_|.-]{1,128}$/;
const BANNED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const BAD_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;
const THEMES = new Set(['paper', 'daylight', 'dusk', 'night', 'eclipse']);
const DISTANCE_UNITS = new Set(['imperial', 'metric']);
const SET_NAMES = ['favs', 'favEvents', 'favArt', 'hiddenDays'] as const;
const SET_BASES: Record<(typeof SET_NAMES)[number], string> = {
  favs: LS.favs,
  favEvents: LS.favEvents,
  favArt: LS.favArt,
  hiddenDays: LS.hiddenDays,
};

export interface SyncSetEntry {
  t: number;
  del?: 1;
}

export interface SyncRegisterEntry {
  t: number;
  v?: unknown;
  del?: 1;
}

export interface SyncDoc {
  schema: typeof SYNC_SCHEMA;
  updatedAt: number;
  deviceId: string;
  sets: Record<string, Record<string, SyncSetEntry>>;
  registers: Record<string, SyncRegisterEntry>;
}

interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function dict<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

export function emptySyncDoc(deviceId: string, at = Date.now()): SyncDoc {
  return { schema: SYNC_SCHEMA, updatedAt: at, deviceId, sets: dict(), registers: dict() };
}

function finiteStamp(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0
    ? Math.floor(raw)
    : null;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort()
    .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}

function sameValue(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

function parseArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((item): item is string => (
      typeof item === 'string' && ID_RE.test(item) && item.length <= MAX_ID_LEN
    )))];
  } catch { return []; }
}

function parseJson(raw: string | null, fallback: unknown): unknown {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function cleanNickname(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 64 || BAD_CHARS.test(raw)) return null;
  if (BANNED_KEYS.has(raw.trim())) return null;
  return raw;
}

function cleanId(raw: unknown, allowEmpty = false): string | null {
  if (raw === '' && allowEmpty) return '';
  return typeof raw === 'string' && ID_RE.test(raw) ? raw : null;
}

function cleanIdArray(raw: unknown, max = MAX_SET_ITEMS): string[] | null {
  if (!Array.isArray(raw) || raw.length > max) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    const id = cleanId(value);
    if (!id) return null;
    if (!seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
}

function cleanMeetSpots(raw: unknown): MeetSpot[] | null {
  if (!Array.isArray(raw) || raw.length > 50) return null;
  const out: MeetSpot[] = [];
  for (const value of raw) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (typeof row.label !== 'string' || !row.label.trim() || row.label.length > 80 || BAD_CHARS.test(row.label)) return null;
    if (typeof row.address !== 'string' || !row.address.trim() || row.address.length > 80 || BAD_CHARS.test(row.address)) return null;
    if (row.when !== undefined && (typeof row.when !== 'string' || row.when.length > 80 || BAD_CHARS.test(row.when))) return null;
    out.push({
      label: row.label.trim(), address: row.address.trim(),
      ...(typeof row.when === 'string' && row.when.trim() ? { when: row.when.trim() } : {}),
    });
  }
  return out;
}

function meetSpotId(spot: MeetSpot): string {
  // Meet spots currently have add/delete (no edit) semantics, so normalized
  // content is their stable identity. FNV-1a 64 keeps register keys compact;
  // the value remains in the document and is validated against the id.
  const canonical = stable({
    label: spot.label.trim(), address: spot.address.trim(),
    ...(spot.when?.trim() ? { when: spot.when.trim() } : {}),
  });
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(canonical)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function meetSpotKey(source: Source, spot: MeetSpot): string {
  return `meetSpot/${source}/${meetSpotId(spot)}`;
}

function meetSpotIdFromKey(key: string, source: Source): string | null {
  const match = new RegExp(`^meetSpot/${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([0-9a-f]{16})$`).exec(key);
  return match?.[1] ?? null;
}

/** Upgrade the original whole-array meetSpots register to per-spot registers. */
export function migrateMeetSpotRegisters(doc: SyncDoc): SyncDoc {
  for (const key of Object.keys(doc.registers)) {
    const match = /^meetSpots\/([^/]+)$/.exec(key);
    if (!match || !validSource(match[1])) continue;
    const legacy = doc.registers[key];
    if (legacy.del !== 1) {
      const spots = cleanMeetSpots(legacy.v) ?? [];
      for (const spot of spots) {
        const logical = meetSpotKey(match[1], spot);
        const existing = doc.registers[logical];
        if (!existing || existing.t < legacy.t) {
          doc.registers[logical] = { t: legacy.t, v: spot };
        }
      }
    }
    delete doc.registers[key];
  }
  return doc;
}

function cleanFriend(name: string, raw: unknown): FriendFavs | null {
  if (!cleanNickname(name) || !name.trim()) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const campIds = cleanIdArray(row.campIds);
  const eventIds = cleanIdArray(row.eventIds);
  if (!campIds || !eventIds) return null;
  const artIds = row.artIds === undefined ? undefined : cleanIdArray(row.artIds);
  if (row.artIds !== undefined && !artIds) return null;
  if (typeof row.importedAt !== 'string' || row.importedAt.length > 64 || BAD_CHARS.test(row.importedAt)) return null;
  const myCampId = row.myCampId === undefined ? undefined : cleanId(row.myCampId);
  if (row.myCampId !== undefined && myCampId === null) return null;
  const meetSpots = row.meetSpots === undefined ? undefined : cleanMeetSpots(row.meetSpots);
  if (row.meetSpots !== undefined && !meetSpots) return null;
  return {
    name,
    campIds,
    eventIds,
    importedAt: row.importedAt,
    ...(artIds ? { artIds } : {}),
    ...(myCampId ? { myCampId } : {}),
    ...(meetSpots && meetSpots.length ? { meetSpots } : {}),
  };
}

function cleanLayers(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length > 50) return null;
  const layers = raw.filter((value): value is string => (
    typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
  ));
  return layers.length === raw.length ? [...new Set(layers)] : null;
}

function validSource(source: string): boolean {
  return SOURCE_RE.test(source) && !BANNED_KEYS.has(source);
}

function setKey(name: (typeof SET_NAMES)[number], source: Source): string {
  return `${name}/${source}`;
}

function sourceFromSetKey(key: string): Source | null {
  const match = /^(?:favs|favEvents|favArt|hiddenDays)\/(.+)$/.exec(key);
  return match && validSource(match[1]) ? match[1] : null;
}

function sourceFromRegisterKey(key: string): Source | null {
  const match = /^(?:myCampId|meetSpots|meetSpot|sharedFavs)\/([^/]+)/.exec(key);
  return match && validSource(match[1]) ? match[1] : null;
}

function b64urlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecode(value: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(value)) return null;
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/')
      + '='.repeat((4 - value.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return null; }
}

function friendKey(source: Source, name: string): string {
  return `sharedFavs/${source}/${b64urlEncode(name)}`;
}

function friendNameFromKey(key: string, source: Source): string | null {
  const prefix = `sharedFavs/${source}/`;
  if (!key.startsWith(prefix)) return null;
  const name = b64urlDecode(key.slice(prefix.length));
  return name && !BANNED_KEYS.has(name) && name.length <= 64 ? name : null;
}

function cloneDoc(doc: SyncDoc): SyncDoc {
  return parseSyncDoc(JSON.stringify(doc)) ?? emptySyncDoc(doc.deviceId, doc.updatedAt);
}

function currentSources(storage: StorageLike, requested: readonly Source[], baseline: SyncDoc | null): Source[] {
  const sources = new Set(requested.filter(validSource));
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i) ?? '';
    for (const base of Object.values(SET_BASES).concat([LS.sharedFavs, LS.myCampId, LS.meetSpots])) {
      const prefix = `${base}/`;
      if (key.startsWith(prefix)) {
        const source = key.slice(prefix.length);
        if (validSource(source)) sources.add(source);
      }
    }
  }
  if (baseline) {
    for (const key of Object.keys(baseline.sets)) {
      const source = sourceFromSetKey(key);
      if (source) sources.add(source);
    }
    for (const key of Object.keys(baseline.registers)) {
      const source = sourceFromRegisterKey(key);
      if (source) sources.add(source);
    }
  }
  return [...sources].sort();
}

function setLocalEntry(
  entries: Record<string, SyncSetEntry>, id: string, active: boolean, at: number,
): void {
  const previous = entries[id];
  const wasActive = !!previous && previous.del !== 1;
  if (!previous || wasActive !== active) entries[id] = active ? { t: at } : { t: at, del: 1 };
}

function setRegister(
  registers: Record<string, SyncRegisterEntry>, key: string, value: unknown,
  at: number, emitEmpty: boolean,
): void {
  const previous = registers[key];
  if (!previous && !emitEmpty) return;
  if (!previous || previous.del === 1 || !sameValue(previous.v, value)) {
    registers[key] = { t: at, v: value };
  }
}

/** Translate localStorage into timestamped operations relative to a baseline. */
export function localToSyncDoc(
  storage: StorageLike,
  sources: readonly Source[],
  baseline: SyncDoc | null,
  deviceId: string,
  at = Date.now(),
): SyncDoc {
  const out = baseline ? cloneDoc(baseline) : emptySyncDoc(deviceId, at);
  migrateMeetSpotRegisters(out);
  const priorOperations = baseline
    ? stable({ sets: baseline.sets, registers: baseline.registers })
    : null;
  out.deviceId = deviceId;
  out.updatedAt = at;
  const hasBaseline = baseline !== null;

  for (const source of currentSources(storage, sources, baseline)) {
    for (const name of SET_NAMES) {
      const logical = setKey(name, source);
      const entries = out.sets[logical] ?? dict<SyncSetEntry>();
      const current = new Set(parseArray(storage.getItem(scopedKey(SET_BASES[name], source))));
      if (hasBaseline) {
        for (const id of Object.keys(entries)) setLocalEntry(entries, id, current.has(id), at);
      }
      for (const id of current) setLocalEntry(entries, id, true, at);
      if (Object.keys(entries).length > 0) out.sets[logical] = entries;
    }

    const myCamp = cleanId(storage.getItem(scopedKey(LS.myCampId, source)) ?? '', true) ?? '';
    setRegister(out.registers, `myCampId/${source}`, myCamp, at, !!myCamp);
    const spots = cleanMeetSpots(parseJson(storage.getItem(scopedKey(LS.meetSpots, source)), [])) ?? [];
    const activeSpotKeys = new Set<string>();
    for (const spot of spots) {
      const key = meetSpotKey(source, spot);
      activeSpotKeys.add(key);
      setRegister(out.registers, key, spot, at, true);
    }
    if (hasBaseline) {
      for (const key of Object.keys(out.registers)) {
        if (!meetSpotIdFromKey(key, source) || activeSpotKeys.has(key)) continue;
        const previous = out.registers[key];
        if (previous.del !== 1) out.registers[key] = { t: at, del: 1 };
      }
    }

    const friendsRaw = parseJson(storage.getItem(scopedKey(LS.sharedFavs, source)), {});
    const friends = friendsRaw && typeof friendsRaw === 'object' && !Array.isArray(friendsRaw)
      ? friendsRaw as Record<string, unknown>
      : {};
    const activeFriendKeys = new Set<string>();
    for (const [name, value] of Object.entries(friends)) {
      if (!name || name.length > 64 || BANNED_KEYS.has(name)) continue;
      const friend = cleanFriend(name, value);
      if (!friend) continue;
      const key = friendKey(source, name);
      activeFriendKeys.add(key);
      setRegister(out.registers, key, friend, at, true);
    }
    if (hasBaseline) {
      for (const key of Object.keys(out.registers)) {
        if (!friendNameFromKey(key, source) || activeFriendKeys.has(key)) continue;
        const previous = out.registers[key];
        if (previous.del !== 1) out.registers[key] = { t: at, del: 1 };
      }
    }
  }

  const nickname = cleanNickname(storage.getItem(LS.nickname) ?? '') ?? '';
  const themeRaw = storage.getItem(LS.theme) ?? 'paper';
  const distanceRaw = storage.getItem(LS.distanceUnit) ?? 'imperial';
  const layers = cleanLayers(parseJson(storage.getItem(LS.mapLayers), [])) ?? [];
  const globals: Array<[string, unknown, boolean]> = [
    ['nickname', nickname, !!storage.getItem(LS.nickname)],
    ['theme', THEMES.has(themeRaw) ? themeRaw : 'paper', !!storage.getItem(LS.theme)],
    ['distanceUnit', DISTANCE_UNITS.has(distanceRaw) ? distanceRaw : 'imperial', !!storage.getItem(LS.distanceUnit)],
    ['mapLayers', layers, !!storage.getItem(LS.mapLayers)],
  ];
  for (const [key, value, present] of globals) {
    setRegister(out.registers, key, value, at, present);
  }
  const operations = stable({ sets: out.sets, registers: out.registers });
  if (baseline && operations === priorOperations) {
    // Root metadata is informational. Preserve it when the local operation
    // set is unchanged so foreground checks can skip needless cloud writes.
    out.deviceId = baseline.deviceId;
    out.updatedAt = baseline.updatedAt;
  } else if (!baseline && !Object.keys(out.sets).length && !Object.keys(out.registers).length) {
    // A genuinely empty fresh device contributes no newer operation merely
    // because its wall clock is later than the backup it is restoring.
    out.updatedAt = 0;
  }
  return out;
}

function pickSetEntry(a?: SyncSetEntry, b?: SyncSetEntry): SyncSetEntry | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.t !== b.t) return a.t > b.t ? a : b;
  if (a.del !== b.del) return a.del === 1 ? b : a; // tie: active wins
  return a;
}

function pickRegister(a?: SyncRegisterEntry, b?: SyncRegisterEntry): SyncRegisterEntry | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.t !== b.t) return a.t > b.t ? a : b;
  if (a.del !== b.del) return a.del === 1 ? b : a; // tie: active wins
  if (a.del === 1) return a;
  return stable(a.v) >= stable(b.v) ? a : b; // deterministic active tie
}

/** Commutative/idempotent LWW merge, with bounded tombstone retention. */
export function mergeSyncDocs(a: SyncDoc, b: SyncDoc, now = Date.now()): SyncDoc {
  const out = emptySyncDoc(
    a.updatedAt > b.updatedAt ? a.deviceId
      : b.updatedAt > a.updatedAt ? b.deviceId
      : [a.deviceId, b.deviceId].sort().at(-1) ?? a.deviceId,
    Math.max(a.updatedAt, b.updatedAt),
  );
  for (const key of new Set([...Object.keys(a.sets), ...Object.keys(b.sets)])) {
    const entries = dict<SyncSetEntry>();
    const left = a.sets[key] ?? {};
    const right = b.sets[key] ?? {};
    for (const id of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const winner = pickSetEntry(left[id], right[id]);
      if (!winner) continue;
      if (winner.del === 1 && winner.t < now - TOMBSTONE_MAX_AGE_MS) continue;
      entries[id] = { ...winner };
    }
    if (Object.keys(entries).length > 0) out.sets[key] = entries;
  }
  for (const key of new Set([...Object.keys(a.registers), ...Object.keys(b.registers)])) {
    const winner = pickRegister(a.registers[key], b.registers[key]);
    if (!winner) continue;
    if (winner.del === 1 && winner.t < now - TOMBSTONE_MAX_AGE_MS) continue;
    out.registers[key] = { ...winner };
  }
  return out;
}

export function syncDocsEqual(a: SyncDoc, b: SyncDoc): boolean {
  return stable(a) === stable(b);
}

function writeIfChanged(storage: StorageLike, key: string, value: string): boolean {
  if (storage.getItem(key) === value) return false;
  storage.setItem(key, value);
  return true;
}

/** Apply active entries to localStorage. Returns true when a reload is needed. */
export function applySyncDoc(storage: StorageLike, doc: SyncDoc): boolean {
  let changed = false;
  const sources = sourcesInSyncDoc(doc);
  for (const source of sources) {
    for (const name of SET_NAMES) {
      const entries = doc.sets[setKey(name, source)];
      if (!entries) continue;
      const active = Object.entries(entries)
        .filter(([, entry]) => entry.del !== 1)
        .map(([id]) => id)
        .sort();
      changed = writeIfChanged(storage, scopedKey(SET_BASES[name], source), JSON.stringify(active)) || changed;
    }
    const myCamp = doc.registers[`myCampId/${source}`];
    if (myCamp && myCamp.del !== 1 && typeof myCamp.v === 'string') {
      changed = writeIfChanged(storage, scopedKey(LS.myCampId, source), myCamp.v) || changed;
    }
    const spots: MeetSpot[] = [];
    let hasSpotEntries = false;
    for (const [key, entry] of Object.entries(doc.registers)) {
      if (!meetSpotIdFromKey(key, source)) continue;
      hasSpotEntries = true;
      if (entry.del !== 1 && entry.v && typeof entry.v === 'object' && !Array.isArray(entry.v)) {
        spots.push(entry.v as MeetSpot);
      }
    }
    if (hasSpotEntries) {
      spots.sort((a, b) => stable(a).localeCompare(stable(b)));
      changed = writeIfChanged(storage, scopedKey(LS.meetSpots, source), JSON.stringify(spots)) || changed;
    }
    const friends: Record<string, FriendFavs> = {};
    let hasFriendEntries = false;
    for (const [key, entry] of Object.entries(doc.registers)) {
      const name = friendNameFromKey(key, source);
      if (!name) continue;
      hasFriendEntries = true;
      if (entry.del !== 1 && entry.v && typeof entry.v === 'object' && !Array.isArray(entry.v)) {
        friends[name] = entry.v as FriendFavs;
      }
    }
    if (hasFriendEntries) {
      changed = writeIfChanged(storage, scopedKey(LS.sharedFavs, source), JSON.stringify(friends)) || changed;
    }
  }

  const globalStrings: Array<[string, string]> = [
    ['nickname', LS.nickname], ['theme', LS.theme], ['distanceUnit', LS.distanceUnit],
  ];
  for (const [logical, storageKey] of globalStrings) {
    const entry = doc.registers[logical];
    if (entry && entry.del !== 1 && typeof entry.v === 'string') {
      changed = writeIfChanged(storage, storageKey, entry.v) || changed;
    }
  }
  const layers = doc.registers.mapLayers;
  if (layers && layers.del !== 1 && Array.isArray(layers.v)) {
    changed = writeIfChanged(storage, LS.mapLayers, JSON.stringify(layers.v)) || changed;
  }
  return changed;
}

export function sourcesInSyncDoc(doc: SyncDoc): Source[] {
  const sources = new Set<Source>();
  for (const key of Object.keys(doc.sets)) {
    const source = sourceFromSetKey(key);
    if (source) sources.add(source);
  }
  for (const key of Object.keys(doc.registers)) {
    const source = sourceFromRegisterKey(key);
    if (source) sources.add(source);
  }
  return [...sources].sort();
}

/** Strict validation for the untrusted Dropbox file. */
export function parseSyncDoc(text: string): SyncDoc | null {
  if (!text || text.length > MAX_SYNC_BYTES) return null;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const root = raw as Record<string, unknown>;
  if (root.schema !== SYNC_SCHEMA) return null;
  const updatedAt = finiteStamp(root.updatedAt);
  if (updatedAt === null || typeof root.deviceId !== 'string' || root.deviceId.length > 128) return null;
  if (!root.sets || typeof root.sets !== 'object' || Array.isArray(root.sets)) return null;
  if (!root.registers || typeof root.registers !== 'object' || Array.isArray(root.registers)) return null;
  const setRows = Object.entries(root.sets as Record<string, unknown>);
  const registerRows = Object.entries(root.registers as Record<string, unknown>);
  if (setRows.length > MAX_DOC_KEYS || registerRows.length > MAX_DOC_KEYS) return null;
  const out = emptySyncDoc(root.deviceId, updatedAt);

  for (const [key, value] of setRows) {
    if (BANNED_KEYS.has(key) || !sourceFromSetKey(key)) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const rows = Object.entries(value as Record<string, unknown>);
    if (rows.length > MAX_SET_ITEMS) return null;
    const entries = dict<SyncSetEntry>();
    for (const [id, candidate] of rows) {
      if (BANNED_KEYS.has(id) || !ID_RE.test(id)) return null;
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
      const row = candidate as Record<string, unknown>;
      const t = finiteStamp(row.t);
      if (t === null || (row.del !== undefined && row.del !== 1)) return null;
      entries[id] = row.del === 1 ? { t, del: 1 } : { t };
    }
    out.sets[key] = entries;
  }

  for (const [key, candidate] of registerRows) {
    const validGlobal = ['nickname', 'theme', 'distanceUnit', 'mapLayers'].includes(key);
    const validScoped = sourceFromRegisterKey(key) !== null;
    if (BANNED_KEYS.has(key) || (!validGlobal && !validScoped)) return null;
    if (key.startsWith('sharedFavs/')) {
      const source = sourceFromRegisterKey(key);
      if (!source || !friendNameFromKey(key, source)) return null;
    } else if (!/^(?:nickname|theme|distanceUnit|mapLayers|myCampId\/[A-Za-z0-9._-]+|meetSpots\/[A-Za-z0-9._-]+|meetSpot\/[A-Za-z0-9._-]+\/[0-9a-f]{16})$/.test(key)) {
      return null;
    }
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const row = candidate as Record<string, unknown>;
    const t = finiteStamp(row.t);
    if (t === null || (row.del !== undefined && row.del !== 1)) return null;
    if (row.del === 1) {
      out.registers[key] = { t, del: 1 };
      continue;
    }
    if (!('v' in row)) return null;
    let value: unknown = row.v;
    if (key === 'nickname') value = cleanNickname(row.v);
    else if (key === 'theme') value = typeof row.v === 'string' && THEMES.has(row.v) ? row.v : null;
    else if (key === 'distanceUnit') value = typeof row.v === 'string' && DISTANCE_UNITS.has(row.v) ? row.v : null;
    else if (key === 'mapLayers') value = cleanLayers(row.v);
    else if (key.startsWith('myCampId/')) value = cleanId(row.v, true);
    else if (key.startsWith('meetSpots/')) value = cleanMeetSpots(row.v);
    else if (key.startsWith('meetSpot/')) {
      const spots = cleanMeetSpots([row.v]);
      value = spots?.[0] ?? null;
      const source = sourceFromRegisterKey(key);
      const id = source ? meetSpotIdFromKey(key, source) : null;
      if (!id || (value && meetSpotId(value as MeetSpot) !== id)) value = null;
    }
    else if (key.startsWith('sharedFavs/')) {
      const source = sourceFromRegisterKey(key)!;
      const name = friendNameFromKey(key, source)!;
      value = cleanFriend(name, row.v);
    }
    if (value === null) return null;
    out.registers[key] = { t, v: value };
  }
  return out;
}

export function loadSyncBaseline(storage: Pick<StorageLike, 'getItem'>): SyncDoc | null {
  const raw = storage.getItem(LS.syncBase);
  const parsed = raw ? parseSyncDoc(raw) : null;
  return parsed ? migrateMeetSpotRegisters(parsed) : null;
}

export function saveSyncBaseline(storage: Pick<StorageLike, 'setItem'>, doc: SyncDoc): void {
  storage.setItem(LS.syncBase, JSON.stringify(doc));
}

export function getOrCreateDeviceId(storage: Pick<StorageLike, 'getItem' | 'setItem'>): string {
  const existing = storage.getItem(LS.syncDevice);
  if (existing && /^[A-Za-z0-9-]{8,128}$/.test(existing)) return existing;
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  storage.setItem(LS.syncDevice, id);
  return id;
}

/** Narrow predicate used by the auto-sync event listener. */
export function isSyncedStorageKey(key: string): boolean {
  if ([LS.nickname, LS.theme, LS.distanceUnit, LS.mapLayers].includes(key as never)) return true;
  return Object.values(SET_BASES).concat([LS.sharedFavs, LS.myCampId, LS.meetSpots])
    .some((base) => key.startsWith(`${base}/`));
}

// Exported only to make value-shape intent visible to TypeScript users of the
// module; runtime validation of these nested values happens when they are
// applied by existing hooks/snapshot guards.
export type SyncedMeetSpots = MeetSpot[];
