// Ask assistant state (ADR 21, semantic rewrite). ONE path: the user opts into
// a ~35 MB on-device model download; after that, a typed question is embedded
// and matched by MEANING against the shipped record vectors, returning real
// camp/art cards ranked by an Orama vector index. No generative model, no
// keyword fallback — if the model isn't downloaded, the feature isn't usable.
// Everything is on-device (transformers.js CPU/WASM); nothing leaves the device.

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Art, Camp } from '../types';
import { addressToLatLng, haversineMeters } from '../map/address';
import { eventAvailability } from '../utils/foodAvailability';
import { now } from '../utils/clock';
import { hasEmbeddings, fetchEmbeddings } from '../assistant/embeddings';
import {
  loadSemanticBackend,
  type Embedder, type EmbeddingsPayload, type LoadProgress, type SearchDb,
} from '../assistant/semanticLoader';

export interface AskCorpus {
  source: string;            // active source — vectors are keyed source:kind:id
  camps: Camp[];
  art: Art[];
  campFavs: ReadonlySet<string>;
  eventFavs: ReadonlySet<string>;
  artFavs: ReadonlySet<string>;
}

export interface AskItem {
  kind: 'camp' | 'event' | 'art';
  id: string;
  campId?: string;         // for events: the host camp (for navigation)
  title: string;
  subtitle: string;
  snippet: string;
  score: number;
  faved: boolean;
  distance?: string;       // e.g. "0.4 mi" when the Near-me filter is on
  distanceM?: number;      // raw metres, for sorting
  timing?: 'now' | 'soon'; // event happening now / starting soon (vs current time)
}

export interface AskFilters {
  nowOnly?: boolean;                       // only events happening now / soon
  near?: { lat: number; lng: number } | null;  // sort by distance from here
}

export type DownloadStatus = 'idle' | 'loading' | 'ready' | 'error';
export interface DownloadState {
  status: DownloadStatus;
  progress: number;   // 0..1
  text: string;
  error: string | null;
}

export interface AssistantController {
  available: boolean;         // the build shipped vectors (feature can exist)
  download: DownloadState;
  loading: boolean;           // answering a query
  items: AskItem[];
  facts: string[];
  ask: (question: string, filters?: AskFilters) => Promise<void>;
  startDownload: () => void;
  reset: () => void;
}

/** The heavy/external dependencies, injectable so the hook is unit-testable
 *  without loading the code-split transformers.js chunk. */
export interface AssistantDeps {
  hasEmbeddings: () => boolean;
  fetchEmbeddings: () => Promise<EmbeddingsPayload | null>;
  loadBackend: typeof loadSemanticBackend;
}
const DEFAULT_DEPS: AssistantDeps = { hasEmbeddings, fetchEmbeddings, loadBackend: loadSemanticBackend };

function miles(m: number): string {
  const mi = m / 1609.34;
  return mi < 0.1 ? `${Math.round(m / 0.3048)} ft` : `${mi.toFixed(1)} mi`;
}

const READY_FLAG = 'bm-ai-model-ready';   // hint to auto-load from cache next time
const MAX_ITEMS = 12;
const IDLE: DownloadState = { status: 'idle', progress: 0, text: '', error: null };

function trim(text: string, n = 160): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  return clean.length > n ? clean.slice(0, n).trimEnd() + '…' : clean;
}

/** Friendly, network-aware failure text. Most setup failures are just no
 *  connection (the assets live on R2 / the model isn't cached yet). */
function setupError(e: unknown): string {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'You’re offline — reconnect to set up Ask, then try again.';
  }
  const msg = e instanceof Error ? e.message : '';
  return msg && !/failed to fetch|networkerror|load failed/i.test(msg)
    ? msg
    : 'Couldn’t download — check your connection and try again.';
}

export function useAssistant(corpus: AskCorpus, active: boolean, deps: AssistantDeps = DEFAULT_DEPS): AssistantController {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const [available, setAvailable] = useState(false);
  const [download, setDownload] = useState<DownloadState>(IDLE);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<AskItem[]>([]);
  const [facts, setFacts] = useState<string[]>([]);

  const payloadRef = useRef<EmbeddingsPayload | null>(null);
  const embedRef = useRef<Embedder | null>(null);
  const dbRef = useRef<SearchDb | null>(null);
  const modRef = useRef<Awaited<ReturnType<typeof loadSemanticBackend>> | null>(null);
  // Bumped every time Ask closes; a load() that resolves afterward sees a stale
  // generation and bails (disposing what it made) instead of repopulating refs.
  const genRef = useRef(0);
  // The recordMap the current index was built for — lets the rebuild effect skip
  // when nothing changed (avoids a redundant rebuild right after load()).
  const indexedForRef = useRef<Map<string, unknown> | null>(null);

  // key → the live camp/event/art record (only what the client actually has).
  const recordMap = useMemo(() => {
    type Rec =
      | { kind: 'camp'; camp: Camp }
      | { kind: 'event'; event: Camp['events'][number]; camp: Camp }
      | { kind: 'art'; art: Art };
    const m = new Map<string, Rec>();
    const src = corpus.source;   // vectors are keyed source:kind:id (see builder)
    for (const c of corpus.camps) {
      m.set(`${src}:camp:${c.id}`, { kind: 'camp', camp: c });
      for (const e of c.events || []) m.set(`${src}:event:${e.id}`, { kind: 'event', event: e, camp: c });
    }
    for (const a of corpus.art) m.set(`${src}:art:${a.id}`, { kind: 'art', art: a });
    return m;
  }, [corpus.source, corpus.camps, corpus.art]);
  const recordMapRef = useRef(recordMap);
  recordMapRef.current = recordMap;
  const corpusRef = useRef(corpus);
  corpusRef.current = corpus;

  // Cheap availability check when the surface opens — a meta tag, no big fetch.
  useEffect(() => {
    if (active) setAvailable(depsRef.current.hasEmbeddings());
  }, [active]);

  const load = useCallback(async (): Promise<boolean> => {
    const gen = genRef.current;
    try {
      if (!payloadRef.current) payloadRef.current = await depsRef.current.fetchEmbeddings();
      if (gen !== genRef.current) return false;
      const payload = payloadRef.current;
      // availability was already meta-gated, so a null payload here means the
      // fetch of embeddings.json failed (offline / cache miss), not a missing index.
      if (!payload || !payload.keys.length) throw new Error('Could not load the search index.');
      const mod = modRef.current ?? (modRef.current = await depsRef.current.loadBackend());
      if (gen !== genRef.current) return false;
      if (!embedRef.current) {
        const embedder = await mod.loadEmbedder((p: LoadProgress) =>
          setDownload((d) => (d.status === 'loading' ? { ...d, progress: p.progress, text: p.text } : d)));
        if (gen !== genRef.current) { void embedder.dispose(); return false; }   // Ask closed mid-load
        embedRef.current = embedder;
      }
      // Build the index BEFORE the caller marks ready, so `ready` always implies a
      // usable index (and a build failure rejects `load()` → shows an error).
      const map = recordMapRef.current;
      const db = await mod.buildIndex(payload, (key) => map.has(key));
      if (gen !== genRef.current) return false;   // closed while building
      dbRef.current = db;
      indexedForRef.current = map;
      return true;
    } catch (e) {
      // A rejected import/model load after close is cancellation, not a setup
      // error to display on the next open.
      if (gen !== genRef.current) return false;
      throw e;
    }
  }, []);

  // Rebuild the index only when the active records actually change (e.g. a
  // source switch) after load() already built it — so Ask never searches a
  // stale source. Surfaces a build failure rather than swallowing it.
  useEffect(() => {
    if (!active || download.status !== 'ready' || !modRef.current || !payloadRef.current) return;
    if (indexedForRef.current === recordMap) return;   // already indexed for this source
    const gen = genRef.current;
    let cancelled = false;
    void modRef.current.buildIndex(payloadRef.current, (key) => recordMap.has(key))
      .then((db) => { if (!cancelled && gen === genRef.current) { dbRef.current = db; indexedForRef.current = recordMap; } })
      .catch(() => { if (!cancelled) setDownload({ status: 'error', progress: 0, text: '', error: 'Search index failed to build.' }); });
    return () => { cancelled = true; };
  }, [active, download.status, recordMap]);

  // Foreground-only: free the model + index when Ask closes (the component stays
  // mounted while hidden). Bumping the generation cancels any in-flight load(),
  // and dispose() explicitly releases the ONNX session. Reopen reloads from
  // cache. Embedding only ever runs on a typed query → no background compute.
  useEffect(() => {
    if (active) return;
    genRef.current++;
    void embedRef.current?.dispose();
    embedRef.current = null;
    dbRef.current = null;
    indexedForRef.current = null;
    // A cancelled load must return to idle. Its promise resolves `false`, so it
    // cannot later overwrite this with a false-ready state.
    setDownload(IDLE);
  }, [active]);

  // If the model was downloaded before, auto-load it from cache (fast, offline)
  // when the surface opens — no need to click Download again.
  useEffect(() => {
    if (!active || download.status !== 'idle' || !available) return;
    if (localStorage.getItem(READY_FLAG) !== '1') return;
    setDownload((d) => ({ ...d, status: 'loading' }));
    void load()
      .then((loaded) => { if (loaded) setDownload({ status: 'ready', progress: 1, text: '', error: null }); })
      .catch(() => setDownload(IDLE));   // fall back to showing the prompt
  }, [active, available, download.status, load]);

  const startDownload = useCallback(() => {
    setDownload({ status: 'loading', progress: 0, text: 'Starting…', error: null });
    void load()
      .then((loaded) => {
        if (!loaded) return;
        localStorage.setItem(READY_FLAG, '1');
        setDownload({ status: 'ready', progress: 1, text: '', error: null });
      })
      .catch((e) => setDownload({ status: 'error', progress: 0, text: '', error: setupError(e) }));
  }, [load]);

  const ask = useCallback(async (question: string, filters?: AskFilters) => {
    const q = question.trim();
    if (!q || !embedRef.current || !dbRef.current || !modRef.current) return;
    const nowOnly = !!filters?.nowOnly;
    const near = filters?.near ?? null;
    setLoading(true);
    try {
      const vec = await embedRef.current.embed(q);
      // Widen the candidate pool when filtering so there's material to keep.
      const pool = (nowOnly || near) ? 60 : MAX_ITEMS;
      const hits = await modRef.current.searchIndex(dbRef.current, vec, pool);
      const map = recordMapRef.current;
      const when = now();
      const fav = corpusRef.current;
      const out: AskItem[] = [];
      for (const h of hits) {
        const rec = map.get(h.key);
        if (!rec) continue;

        let item: AskItem;
        let location = '';
        if (rec.kind === 'camp') {
          if (nowOnly) continue;                 // "on now" is an event filter
          const c = rec.camp;
          location = c.location;
          item = {
            kind: 'camp', id: c.id, title: c.name,
            subtitle: c.location && c.location !== 'None Listed' ? c.location : '',
            snippet: trim(c.description), score: h.score, faved: fav.campFavs.has(c.id),
          };
        } else if (rec.kind === 'event') {
          const e = rec.event;
          const c = rec.camp;
          const av = eventAvailability(e, when);   // 'now' | 'soon' | 'later' | 'anytime'
          if (nowOnly && av !== 'now' && av !== 'soon') continue;
          location = c.location;
          item = {
            kind: 'event', id: e.id, campId: c.id, title: e.name || 'Event',
            subtitle: [e.display_time || e.time || '', `at ${c.name}`].filter(Boolean).join(' · '),
            snippet: trim(e.description), score: h.score, faved: fav.eventFavs.has(e.id),
            ...(av === 'now' ? { timing: 'now' as const } : av === 'soon' ? { timing: 'soon' as const } : {}),
          };
        } else {
          if (nowOnly) continue;
          const a = rec.art;
          location = a.location;
          item = {
            kind: 'art', id: a.id, title: a.name,
            subtitle: [a.artist ? `by ${a.artist}` : '', a.location].filter(Boolean).join(' · '),
            snippet: trim(a.description), score: h.score, faved: fav.artFavs.has(a.id),
          };
        }

        if (near) {
          const ll = location && location !== 'None Listed' ? addressToLatLng(location) : null;
          if (!ll) continue;                     // no placeable address → drop for Near-me
          const m = haversineMeters(near, ll);
          item.distanceM = m;
          item.distance = miles(m);
        }
        out.push(item);
      }

      if (near) out.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
      const top = out.slice(0, MAX_ITEMS);
      setItems(top);
      const suffix = near ? ' nearest first' : nowOnly ? ' on now' : '';
      setFacts([top.length ? `${top.length} result${top.length === 1 ? '' : 's'}${suffix}.` : 'No matches — try different words.']);
    } catch {
      setItems([]);
      setFacts(['Something went wrong running the search.']);
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => { setItems([]); setFacts([]); }, []);

  return { available, download, loading, items, facts, ask, startDownload, reset };
}
