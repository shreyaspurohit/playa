// Root: holds all cross-component state (query, active tags, favorites,
// fav-only filter, theme, info modal, current tab, map target, etc.)
// and wires it up.
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Art, Camp, EncryptedPayload, Source } from '../types';
import { LS, scopedKey } from '../types';
import {
  readEmbeddedPayload, readEmbeddedArt,
  indexHaystacks, haystackOf,
  indexArtHaystacks, artHaystackOf,
} from '../data';
import type { EnvelopeSource } from '../data';
import { decryptSource, decryptPayload } from '../crypto';
import {
  applyLocationEmbargo, applyArtLocationEmbargo, isLocationEmbargoed,
} from '../utils/embargo';
import { readString, writeString } from '../utils/storage';
import { loadCachedPassword } from '../utils/secureStore';
import { readShareFromUrl, clearShareFromUrl } from '../utils/share';
import type { SharePayload } from '../utils/share';
import {
  applySnapshot, pickSnapshotFile,
} from '../utils/exportImport';
import { useFavorites } from '../hooks/useFavorites';
import { useFriends } from '../hooks/useFriends';
import { useMeetSpots } from '../hooks/useMeetSpots';
import { useSource, migrateLegacyKeysOnce } from '../hooks/useSource';
import { useTheme } from '../hooks/useTheme';
import { useHashRoute } from '../hooks/useHashRoute';
import { ActionBar } from './ActionBar';
import { ArtView } from './ArtView';
import { CampsView } from './CampsView';
import { ExportModal } from './ExportModal';
import { EmbargoLiftedBanner } from './EmbargoLiftedBanner';
import { EnvelopeGate } from './EnvelopeGate';
import { Footer } from './Footer';
import { Gate } from './Gate';
import { Header } from './Header';
import { ImportBanner } from './ImportBanner';
import { SnapshotImportBanner } from './SnapshotImportBanner';
import { UpdateBanner } from './UpdateBanner';
import { ReleaseNotesBanner } from './ReleaseNotesBanner';
import { useVersionCheck } from '../hooks/useVersionCheck';
import { useReleaseNotes } from '../hooks/useReleaseNotes';
import type { Snapshot } from '../utils/exportImport';
import { InfoModal } from './InfoModal';
import { MapView } from './MapView';
import { ScheduleView } from './ScheduleView';
import { ShareModal } from './ShareModal';
import { TabBar } from './TabBar';
import { Toolbar } from './Toolbar';

interface Meta {
  fetchedDate: string;
  fetchedAt: string;
  version: string;
  contactEmail: string;
  /** Burn window (ISO YYYY-MM-DD). `burnStart` is the gate-open day —
   *  also the location-embargo cutoff (D8) and the spirit-mode
   *  auto-unlock window's open edge (D13). The schedule view uses
   *  the [burnStart, burnEnd] range as its calendar window. */
  burnStart: string;
  burnEnd: string;
}

function readMeta(): Meta {
  const get = (n: string) =>
    (document.querySelector(`meta[name="${n}"]`) as HTMLMetaElement | null)
      ?.content ?? '';
  return {
    fetchedDate:  get('bm-fetched-date') || 'unknown',
    fetchedAt:    get('bm-fetched-at')   || 'unknown',
    version:      get('bm-version')      || 'v0.0.0',
    contactEmail: get('bm-contact-email') || 'bm-camps@example.com',
    burnStart:    get('bm-burn-start') || '',
    burnEnd:      get('bm-burn-end')   || '',
  };
}

export function App() {
  const meta = useMemo(readMeta, []);
  const { theme, setTheme } = useTheme();
  const { view, goto } = useHashRoute();
  const { updateAvailable, latest: latestVersion } = useVersionCheck();
  const { pending: pendingReleaseNotes, dismiss: dismissReleaseNotes } = useReleaseNotes();

  // One-shot LS migration: pre-multi-source builds wrote bare keys
  // (bm-favs, bm-fav-events, …); copy each into its `/directory` slot
  // so existing users see their data under the default source.
  useMemo(() => migrateLegacyKeysOnce(), []);

  const { source, setSource, available: availableSources } = useSource();

  const [camps, setCamps] = useState<Camp[] | null>(null);
  const [encEnvelope, setEncEnvelope] = useState<EncryptedPayload | null>(null);
  // True if any ingest pass during this session masked locations
  // under the pre-burn embargo. Drives the EmbargoLiftedBanner — we
  // only nudge the user to refresh when their in-memory camps were
  // actually masked at some point. Stays sticky once flipped on.
  const [embargoActiveAtIngest, setEmbargoActiveAtIngest] = useState(false);
  const [embargoLifted, setEmbargoLifted] = useState(false);
  // Envelope-mode (D10) state. `envelopeSources` is the build-embedded
  // ciphers + wrappers; `unlocked.deks` is what the password unlocked
  // (one DEK+IV per source the user has access to). Both null in
  // single-tier (legacy) builds.
  //
  // `unlocked.trusted` flips on when the password unwrapped a wrapper
  // flagged trusted by the build (`bm-trusted-wrappers`, today =
  // god-mode). Trusted users bypass the pre-burn location embargo
  // — see `isLocationEmbargoed`. Burn-key auto-unlock (spirit-mode)
  // leaves it false; god-mode is reached only via password.
  //
  // Bundled into ONE state object so trust + deks land in the same
  // render atomically. Previously two separate setState calls; if
  // they didn't batch (Preact 10 is usually OK but async-callback
  // ordering isn't 100% guaranteed), the decrypt effect could fire
  // with old trust + new deks, mask locations, and cache them in
  // `decryptedRef` — leaving god-mode users stuck behind the
  // embargo until reload.
  const [envelopeSources, setEnvelopeSources] = useState<EnvelopeSource[] | null>(null);
  const [unlocked, setUnlocked] = useState<{
    deks: Map<Source, Uint8Array>;
    trusted: boolean;
  } | null>(null);
  const unlockedDeks = unlocked?.deks ?? null;
  const unlockedTrusted = unlocked?.trusted ?? false;
  // Memo cache: source → decrypted Camp[]. Avoids re-running
  // decryptSource + JSON.parse + indexHaystacks on every flip back to
  // a previously-viewed source. Ref instead of state because mutating
  // the cache shouldn't trigger a re-render.
  const decryptedRef = useRef<Map<Source, Camp[]>>(new Map());
  // Parallel cache + state for art per source.
  const [art, setArt] = useState<Art[] | null>(null);
  const decryptedArtRef = useRef<Map<Source, Art[]>>(new Map());

  // Detect mode + (re)load source-specific data when source changes.
  // Envelope mode reads ALL sources up front (one effect, not per
  // source); the second effect below decrypts on source-change using
  // cached DEK+IVs.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await readEmbeddedPayload(source);
        if (cancelled) return;
        if (p.kind === 'plain') {
          // Apply pre-burn location embargo (D8). For api-<burn_year>
          // pre-burn-start, this clears `camp.location` on every camp;
          // outside the embargo window (or for trusted/god-mode users)
          // it's a no-op.
          if (isLocationEmbargoed(source, meta.burnStart, new Date(), unlockedTrusted)) {
            setEmbargoActiveAtIngest(true);
          }
          const masked = applyLocationEmbargo(p.camps, source, meta.burnStart, new Date(), unlockedTrusted);
          indexHaystacks(masked);
          setCamps(masked);
          setEncEnvelope(null);
          setEnvelopeSources(null);
        } else if (p.kind === 'encrypted') {
          setCamps(null);
          setEncEnvelope(p.enc);
          setEnvelopeSources(null);
        } else {
          // Envelope mode: stash all sources, wait for user password.
          setCamps(null);
          setEncEnvelope(null);
          setEnvelopeSources(p.sources);
        }
      } catch (err) {
        if (cancelled) return;
        // Switching to a source that wasn't embedded — degrade gracefully.
        console.warn('readEmbeddedPayload failed:', err);
        setCamps([]);
        setEncEnvelope(null);
        setEnvelopeSources(null);
      }
    })();
    return () => { cancelled = true; };
  }, [source]);

  // Parallel art ingest. For plain mode the bundle has an
  // art-data-<source> script; pull + index on source change. For
  // envelope mode the art comes via the artCipher in EnvelopeSource
  // — handled in the dedicated decrypt effect below.
  useEffect(() => {
    if (envelopeSources) return;   // envelope flow handles art separately
    if (encEnvelope) return;       // single-tier encrypted: art handled in onUnlock
    let cancelled = false;
    (async () => {
      try {
        const p = await readEmbeddedArt(source);
        if (cancelled) return;
        if (p.kind === 'plain') {
          const masked = applyArtLocationEmbargo(
            p.art, source, meta.burnStart, new Date(), unlockedTrusted,
          );
          indexArtHaystacks(masked);
          setArt(masked);
        }
        // 'encrypted' (single-tier) art is handled together with camps
        // by the legacy `onUnlock` callback below — no-op here.
      } catch (err) {
        if (cancelled) return;
        console.warn('readEmbeddedArt failed:', err);
        setArt([]);
      }
    })();
    return () => { cancelled = true; };
  }, [source, envelopeSources, encEnvelope]);

  // Envelope-mode: when source changes (or user finishes unlocking),
  // decrypt the active source's camps + art ciphers with the cached
  // DEK. Both ciphers share a DEK (per source) and use independent
  // IVs — see `_envelope_data_scripts` in builder.py and the
  // `decryptSource` IV-from-cipher behavior in crypto.ts.
  useEffect(() => {
    if (!envelopeSources || !unlockedDeks) return;
    const dekIv = unlockedDeks.get(source);
    if (!dekIv) {
      setCamps([]);
      setArt([]);
      return;
    }
    const cachedCamps = decryptedRef.current.get(source);
    const cachedArt = decryptedArtRef.current.get(source);
    if (cachedCamps) setCamps(cachedCamps);
    if (cachedArt) setArt(cachedArt);
    if (cachedCamps && cachedArt) return;

    const env = envelopeSources.find((s) => s.source === source);
    if (!env) { setCamps([]); setArt([]); return; }

    let cancelled = false;
    (async () => {
      try {
        // Camps
        if (!cachedCamps) {
          const jsonText = await decryptSource(env.cipher, dekIv);
          if (cancelled) return;
          const raw = JSON.parse(jsonText) as Camp[];
          if (isLocationEmbargoed(source, meta.burnStart, new Date(), unlockedTrusted)) {
            setEmbargoActiveAtIngest(true);
          }
          const arr = applyLocationEmbargo(raw, source, meta.burnStart, new Date(), unlockedTrusted);
          indexHaystacks(arr);
          decryptedRef.current.set(source, arr);
          setCamps(arr);
        }
        // Art
        if (!cachedArt) {
          const artText = await decryptSource(env.artCipher, dekIv);
          if (cancelled) return;
          const rawArt = JSON.parse(artText) as Art[];
          const arr = applyArtLocationEmbargo(
            rawArt, source, meta.burnStart, new Date(), unlockedTrusted,
          );
          indexArtHaystacks(arr);
          decryptedArtRef.current.set(source, arr);
          setArt(arr);
        }
      } catch (err) {
        if (cancelled) return;
        console.error('decryptSource (camps+art) failed:', err);
        setCamps([]);
        setArt([]);
      }
    })();
    return () => { cancelled = true; };
  }, [envelopeSources, unlockedDeks, source]);

  // Source switcher should only offer sources the user actually
  // unlocked. Falls back to the embedded list in non-envelope builds.
  const effectiveAvailableSources: Source[] = unlockedDeks
    ? availableSources.filter((s) => unlockedDeks.has(s))
    : availableSources;

  // If the user's persisted source isn't in their unlocked set
  // (e.g., used to be on god-mode, now on spirit-mode), bump them
  // to the first unlocked source. Runs once after unlock.
  useEffect(() => {
    if (!unlockedDeks) return;
    if (unlockedDeks.has(source)) return;
    const first = [...unlockedDeks.keys()][0];
    if (first) setSource(first);
  }, [unlockedDeks, source, setSource]);

  // ADR D13: burn-window auto-unlock. When the build deployed
  // `site/burn-key.json`, fetch it on boot, parse the per-source
  // DEK+IV blobs, and seed `unlockedDeks` directly — skipping the
  // password prompt. Outside the window the file 404s and we fall
  // through to the normal EnvelopeGate flow.
  //
  // Other tiers (god, demigod) stay password-gated regardless: only
  // sources listed in burn-key.json are auto-unlocked, and only the
  // last tier in SITE_TIERS (conventionally spirit) writes there.
  useEffect(() => {
    if (!envelopeSources || unlockedDeks) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('./burn-key.json', { cache: 'no-store' });
        if (!r.ok) return;
        const raw = await r.json() as Record<string, string>;
        if (cancelled || !raw || typeof raw !== 'object') return;
        const map = new Map<Source, Uint8Array>();
        for (const [src, b64] of Object.entries(raw)) {
          if (typeof b64 !== 'string') continue;
          // base64 → 48-byte DEK+IV. Anything malformed skips that
          // source rather than aborting the whole burn-open path.
          try {
            const bin = atob(b64);
            if (bin.length !== 48) continue;
            const bytes = new Uint8Array(48);
            for (let i = 0; i < 48; i++) bytes[i] = bin.charCodeAt(i);
            map.set(src, bytes);
          } catch { /* skip malformed entry */ }
        }
        // Burn-key auto-unlock is spirit-mode only by design — never
        // trusted. Embargo continues to apply (relevant only between
        // PLAYA_GO_LIVE and burn-start; trusted=false is correct).
        if (!cancelled && map.size > 0) setUnlocked({ deks: map, trusted: false });
      } catch { /* network error / not deployed → fall through to gate */ }
    })();
    return () => { cancelled = true; };
  }, [envelopeSources, unlockedDeks]);

  // ADR D8 follow-up: nudge the user to refresh once the embargo
  // lifts mid-session. Conditions:
  //   1. Their in-memory camps were masked at ingest
  //      (`embargoActiveAtIngest`). If they loaded fresh post-burn,
  //      this stays false and the banner never fires.
  //   2. The cutoff (`meta.burnStart`) has passed — checked on a
  //      1-min poll so a tab open across midnight UTC catches it.
  //   3. Per-burn-year LS flag isn't already set (one-shot per device).
  // Cleared by either button on the banner; refresh re-loads with
  // the masked state false, so the banner won't reappear.
  const embargoYear = meta.burnStart
    ? meta.burnStart.slice(0, 4)
    : '';
  const embargoAckKey = `${LS.embargoLiftAcked}/${embargoYear}`;
  useEffect(() => {
    if (!embargoActiveAtIngest) return;
    if (embargoLifted) return;
    if (!embargoYear) return;
    if (readString(embargoAckKey, '') === '1') return;

    const liftTime = new Date(meta.burnStart + 'T00:00:00Z').getTime();
    if (Number.isNaN(liftTime)) return;

    function check() {
      if (Date.now() >= liftTime) {
        setEmbargoLifted(true);
        return true;
      }
      return false;
    }
    if (check()) return;
    // Poll every minute. Long enough to be cheap; short enough that
    // crossing the cutoff while the tab's foregrounded triggers the
    // banner within a minute.
    const interval = setInterval(() => {
      if (check()) clearInterval(interval);
    }, 60_000);
    return () => clearInterval(interval);
  }, [embargoActiveAtIngest, embargoLifted, embargoYear, embargoAckKey, meta.burnStart]);

  function ackEmbargoLift() {
    writeString(embargoAckKey, '1');
  }

  const onUnlock = useCallback(async (jsonText: string, password: string) => {
    const raw = JSON.parse(jsonText) as Camp[];
    if (isLocationEmbargoed(source, meta.burnStart)) {
      setEmbargoActiveAtIngest(true);
    }
    const unlocked = applyLocationEmbargo(raw, source, meta.burnStart);
    indexHaystacks(unlocked);
    setCamps(unlocked);
    setEncEnvelope(null);

    // Single-tier mode: an `art-data-<source>-encrypted` script is
    // also embedded. Decrypt it with the same password the user just
    // entered, then ingest. If the bundle predates art (no script
    // tag), the call returns an empty list — Art tab just empty.
    try {
      const artPayload = await readEmbeddedArt(source);
      if (artPayload.kind === 'plain') {
        const arr = applyArtLocationEmbargo(
          artPayload.art, source, meta.burnStart,
        );
        indexArtHaystacks(arr);
        setArt(arr);
      } else if (artPayload.kind === 'encrypted') {
        const text = await decryptPayload(artPayload.enc, password);
        const rawArt = JSON.parse(text) as Art[];
        const arr = applyArtLocationEmbargo(
          rawArt, source, meta.burnStart,
        );
        indexArtHaystacks(arr);
        setArt(arr);
      } else {
        setArt([]);
      }
    } catch (err) {
      console.warn('art ingest after Gate unlock failed:', err);
      setArt([]);
    }
  }, [source, meta.burnStart]);

  const [query, setQuery] = useState('');
  const queryLower = query.toLowerCase().trim();
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [showAllTags, setShowAllTags] = useState(false);
  const [favOnly, setFavOnly] = useState(false);
  // "Has a website" filter — narrows to ~40% of camps that posted a
  // URL on the directory. Useful for picking camps in advance: web
  // pages tend to mean a camp organized enough to publish hours,
  // ticketing, or contact info.
  const [webOnly, setWebOnly] = useState(false);
  const [focusKey, setFocusKey] = useState(0);

  // Per-source scoped LS keys — recomputed whenever `source` changes
  // so the hooks below pick up the new slot and re-read.
  const favsKey      = scopedKey(LS.favs, source);
  const eventFavsKey = scopedKey(LS.favEvents, source);
  const artFavsKey   = scopedKey(LS.favArt, source);
  const sharedKey    = scopedKey(LS.sharedFavs, source);
  const meetSpotsKey = scopedKey(LS.meetSpots, source);
  const myCampKey    = scopedKey(LS.myCampId, source);
  const hiddenKey_   = scopedKey(LS.hiddenDays, source);

  const campFavs = useFavorites(favsKey);
  const eventFavs = useFavorites(eventFavsKey);
  const artFavs = useFavorites(artFavsKey);
  const friends = useFriends(sharedKey);
  const meetSpots = useMeetSpots(meetSpotsKey);

  // The user's own home camp — single id, or '' when unset. Separate
  // from campFavs so setting it doesn't pollute the star list, and so
  // friends can see "Alice's camp is here" as a distinct marker on
  // the map after importing her share link.
  const [myCampId, setMyCampId] = useState<string>(
    () => readString(myCampKey, ''),
  );
  const onSetMyCamp = useCallback((id: string) => {
    const next = id === myCampId ? '' : id;   // click again to unset
    writeString(myCampKey, next);
    setMyCampId(next);
  }, [myCampId, myCampKey]);
  // Re-read myCampId when source changes (and on storage events from
  // other tabs writing the same scoped key).
  useEffect(() => {
    setMyCampId(readString(myCampKey, ''));
  }, [myCampKey]);
  useEffect(() => {
    const win = typeof window !== 'undefined' ? window : null;
    if (!win) return;
    function onStorage(e: StorageEvent) {
      if (e.key !== null && e.key !== myCampKey) return;
      setMyCampId(readString(myCampKey, ''));
    }
    win.addEventListener('storage', onStorage);
    return () => win.removeEventListener('storage', onStorage);
  }, [myCampKey]);

  // Long-lived password-share responder. After the gate unlocks, App
  // is the component that lives for the rest of the session — Gate is
  // gone, so its BroadcastChannel listener is gone too. Without a
  // listener on this side, a freshly-opened second tab broadcasts
  // {type:'request'} and gets no response, so it falls through to
  // the password prompt. Keeping the channel open here for the
  // whole session lets sibling tabs decrypt silently.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('BroadcastChannel' in window)) return;
    const channel = new BroadcastChannel('playa-camps-pw');
    channel.onmessage = async (e) => {
      const msg = e.data;
      if (!msg || typeof msg !== 'object' || msg.type !== 'request') return;
      const pw = await loadCachedPassword();
      if (pw) channel.postMessage({ type: 'share', pw });
    };
    return () => { try { channel.close(); } catch { /* ignore */ } };
  }, []);

  // Flatten the friend store into the shape MapView wants: one entry
  // per friend with a camp or spots, nothing for the rest.
  const friendsRendezvous = useMemo(() => {
    return friends.names
      .map((n) => {
        const f = friends.friends[n];
        if (!f) return null;
        if (!f.myCampId && (!f.meetSpots || f.meetSpots.length === 0)) return null;
        return {
          name: f.name,
          myCampId: f.myCampId,
          meetSpots: f.meetSpots,
        };
      })
      .filter(Boolean) as Array<{ name: string; myCampId?: string; meetSpots?: typeof meetSpots.spots }>;
  }, [friends]);

  // Per-day hides for recurring events on the Schedule view. Keys are
  // `${eventId}|${iso}` so one localStorage key stores all (event, day)
  // pairs a user has opted out of.
  const hiddenDays = useFavorites(hiddenKey_);
  const hiddenKey = useCallback((id: string, iso: string) => `${id}|${iso}`, []);
  const isDayHidden = useCallback(
    (eventId: string, iso: string) => hiddenDays.has(hiddenKey(eventId, iso)),
    [hiddenDays, hiddenKey],
  );
  const toggleDayHidden = useCallback(
    (eventId: string, iso: string) => hiddenDays.toggle(hiddenKey(eventId, iso)),
    [hiddenDays, hiddenKey],
  );

  // Starring an event auto-stars its camp (one-way). Makes the map's
  // camp-keyed pin set include every camp the user has an event-interest
  // in, without forcing a second click.
  const eventToCamp = useMemo(() => {
    const m = new Map<string, string>();
    if (!camps) return m;
    for (const c of camps) for (const e of c.events ?? []) m.set(e.id, c.id);
    return m;
  }, [camps]);

  const onToggleFavEvent = useCallback((eventId: string) => {
    const wasStarred = eventFavs.has(eventId);
    eventFavs.toggle(eventId);
    if (wasStarred) return;
    const campId = eventToCamp.get(eventId);
    if (campId && !campFavs.has(campId)) campFavs.toggle(campId);
  }, [eventFavs, campFavs, eventToCamp]);

  // One-time reconcile for pre-existing starred events (before the rule
  // existed). Ref-guarded + LS-flagged so an intentional camp un-star
  // stays stuck across reloads.
  const reconciledRef = useRef<boolean>(readString(LS.eventCampReconciled, '') === '1');
  useEffect(() => {
    if (!camps || reconciledRef.current) return;
    reconciledRef.current = true;
    for (const eventId of eventFavs.favs) {
      const campId = eventToCamp.get(eventId);
      if (campId && !campFavs.has(campId)) campFavs.toggle(campId);
    }
    writeString(LS.eventCampReconciled, '1');
  }, [camps, eventFavs, campFavs, eventToCamp]);

  const [mapTargetId, setMapTargetId] = useState<string | null>(null);
  const [mapArtTargetId, setMapArtTargetId] = useState<string | null>(null);

  // Cross-view nav: when something calls onGotoCamp(id), we flip to the
  // Camps view, clear filters that could hide it, and bump a tick so
  // CampsView re-runs its scroll effect even when id is unchanged.
  const [scrollToCampId, setScrollToCampId] = useState<string | null>(null);
  const [scrollTick, setScrollTick] = useState(0);

  const [shareOpen, setShareOpen] = useState(false);
  const [incomingShare, setIncomingShare] = useState<SharePayload | null>(null);
  useEffect(() => {
    const s = readShareFromUrl();
    if (s) setIncomingShare(s);
  }, []);
  const onImportFriend = useCallback(
    (opts: { targetName: string; mode: 'merge' | 'overwrite' }) => {
      if (!incomingShare) return;
      friends.importFriend(
        opts.targetName,
        {
          campIds: incomingShare.campIds,
          eventIds: incomingShare.eventIds,
          artIds: incomingShare.artIds,
          myCampId: incomingShare.myCampId,
          meetSpots: incomingShare.meetSpots,
        },
        opts.mode,
      );
      setIncomingShare(null);
      clearShareFromUrl();
    },
    [incomingShare, friends],
  );
  const onDismissImport = useCallback(() => {
    setIncomingShare(null);
    clearShareFromUrl();
  }, []);

  /**
   * "This share is from me, on another device" path. Writes the
   * share's payload into the user's OWN LS keys (favs / fav-events /
   * my-camp / meet-spots) and reloads — picks up where the other
   * device left off. Doesn't touch nickname (already matches) or
   * keys that share links don't carry (hiddenDays, friends).
   * For full state transfer including those, use the JSON Export.
   */
  const onImportAsSelf = useCallback(() => {
    if (!incomingShare) return;
    // Self-import targets the CURRENTLY-ACTIVE source. A share carrying
    // its own `source` field (post-multi-source clients) lands in that
    // source's bucket regardless of the importer's current view; the
    // banner has already nudged the importer to switch first if the
    // sources mismatch, so by here `source` is the right slot.
    writeString(scopedKey(LS.favs, source), JSON.stringify(incomingShare.campIds));
    writeString(scopedKey(LS.favEvents, source), JSON.stringify(incomingShare.eventIds));
    if (incomingShare.artIds && incomingShare.artIds.length > 0) {
      writeString(scopedKey(LS.favArt, source), JSON.stringify(incomingShare.artIds));
    }
    writeString(scopedKey(LS.myCampId, source), incomingShare.myCampId ?? '');
    writeString(
      scopedKey(LS.meetSpots, source),
      JSON.stringify(incomingShare.meetSpots ?? []),
    );
    clearShareFromUrl();
    location.reload();
  }, [incomingShare, source]);

  /**
   * Snapshot import flow. Picking the file is browser-native, but
   * the decision (self-restore vs friend-import vs cancel) goes to
   * a banner so the UX matches share-link imports — the user used
   * to see a `confirm()` here which felt out of place.
   *
   * `incomingSnapshot` is the pending pick; the banner stays mounted
   * until the user picks an action OR dismisses, mirroring how
   * `incomingShare` drives ImportBanner.
   */
  const [exportOpen, setExportOpen] = useState(false);
  const onExportSnapshot = useCallback(() => {
    setExportOpen(true);
  }, []);

  const [incomingSnapshot, setIncomingSnapshot] = useState<Snapshot | null>(null);

  const onImportSnapshot = useCallback(async () => {
    const snap = await pickSnapshotFile();
    if (!snap) {
      alert("Couldn't read that file. Make sure it's a Playa Camps export.");
      return;
    }
    setIncomingSnapshot(snap);
  }, []);

  const onApplySnapshotSelf = useCallback(() => {
    if (!incomingSnapshot) return;
    applySnapshot(incomingSnapshot, source);
    setIncomingSnapshot(null);
    location.reload();
  }, [incomingSnapshot, source]);

  const onImportSnapshotAsFriend = useCallback(() => {
    if (!incomingSnapshot) return;
    if (!incomingSnapshot.nickname) {
      alert("This snapshot has no nickname — can't import as a friend.");
      return;
    }
    friends.importFriend(
      incomingSnapshot.nickname,
      {
        campIds: incomingSnapshot.campFavs,
        eventIds: incomingSnapshot.eventFavs,
        artIds: incomingSnapshot.artFavs,
        myCampId: incomingSnapshot.myCampId || undefined,
        meetSpots:
          incomingSnapshot.meetSpots.length > 0
            ? incomingSnapshot.meetSpots
            : undefined,
      },
      'overwrite',
    );
    setIncomingSnapshot(null);
  }, [incomingSnapshot, friends]);

  const onDismissSnapshot = useCallback(() => setIncomingSnapshot(null), []);

  const [infoOpen, setInfoOpen] = useState(false);
  const [infoPulse, setInfoPulse] = useState(() => {
    const n = parseInt(readString(LS.infoSeen, '0'), 10) || 0;
    if (n < 2) {
      writeString(LS.infoSeen, String(n + 1));
      return true;
    }
    return false;
  });
  useEffect(() => {
    if (!infoPulse) return;
    const t = window.setTimeout(() => setInfoPulse(false), 4200);
    return () => window.clearTimeout(t);
  }, [infoPulse]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && infoOpen)  { setInfoOpen(false);  return; }
      if (e.key === 'Escape' && shareOpen) { setShareOpen(false); return; }
      const t = e.target as HTMLElement | null;
      const isInput = t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA';
      if (e.key === '/' && !isInput) {
        e.preventDefault();
        goto('camps');
        setFocusKey((k) => k + 1);
      }
      if (e.key === 'Escape' && isInput && t?.getAttribute('type') === 'search') {
        setQuery('');
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [infoOpen, shareOpen, goto]);

  const sortedTags = useMemo<ReadonlyArray<readonly [string, number]>>(() => {
    if (!camps) return [];
    const freq = new Map<string, number>();
    for (const c of camps) {
      for (const t of c.tags) freq.set(t, (freq.get(t) ?? 0) + 1);
    }
    return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [camps]);

  const campHasFavEvent = useCallback(
    (c: Camp) => {
      if (!eventFavs.size) return false;
      return (c.events || []).some((e) => eventFavs.has(e.id));
    },
    [eventFavs],
  );
  const campHasFriendFavEvent = useCallback(
    (c: Camp) => (c.events || []).some((e) => friends.anyFriendFavEvent(e.id)),
    [friends],
  );
  const matches = useCallback(
    (c: Camp) => {
      if (favOnly) {
        const mine = campFavs.has(c.id) || campHasFavEvent(c);
        const friend = friends.anyFriendFavCamp(c.id) || campHasFriendFavEvent(c);
        if (!mine && !friend) return false;
      }
      if (webOnly && !(c.website && c.website.trim())) return false;
      for (const t of activeTags) if (!c.tags.includes(t)) return false;
      if (queryLower && haystackOf(c).indexOf(queryLower) === -1) return false;
      return true;
    },
    [favOnly, webOnly, campFavs, campHasFavEvent, friends, campHasFriendFavEvent,
     activeTags, queryLower],
  );

  const filtered = useMemo(
    () => (camps ? camps.filter(matches) : []),
    [camps, matches],
  );

  const favMatchCount = useMemo(() => {
    if (!camps) return 0;
    let n = 0;
    for (const c of camps) {
      if (campFavs.has(c.id) || campHasFavEvent(c) ||
          friends.anyFriendFavCamp(c.id) || campHasFriendFavEvent(c)) n++;
    }
    return n;
  }, [camps, campFavs, campHasFavEvent, friends, campHasFriendFavEvent]);

  const webMatchCount = useMemo(() => {
    if (!camps) return 0;
    let n = 0;
    for (const c of camps) if (c.website && c.website.trim()) n++;
    return n;
  }, [camps]);

  // --- Art tab state -------------------------------------------------
  const [artQuery, setArtQuery] = useState('');
  const artQueryLower = artQuery.toLowerCase().trim();
  const [artActiveTags, setArtActiveTags] = useState<Set<string>>(new Set());
  const [artShowAllTags, setArtShowAllTags] = useState(false);
  const [artFavOnly, setArtFavOnly] = useState(false);
  const [scrollToArtId, setScrollToArtId] = useState<string | null>(null);
  const [scrollToArtTick, setScrollToArtTick] = useState(0);

  const artSortedTags = useMemo<ReadonlyArray<readonly [string, number]>>(() => {
    if (!art) return [];
    const freq = new Map<string, number>();
    for (const a of art) for (const t of a.tags) freq.set(t, (freq.get(t) ?? 0) + 1);
    return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [art]);

  const artMatches = useCallback(
    (a: Art) => {
      if (artFavOnly && !artFavs.has(a.id) && !friends.anyFriendFavArt(a.id)) return false;
      for (const t of artActiveTags) if (!a.tags.includes(t)) return false;
      if (artQueryLower && artHaystackOf(a).indexOf(artQueryLower) === -1) return false;
      return true;
    },
    [artFavOnly, artFavs, friends, artActiveTags, artQueryLower],
  );

  const artFiltered = useMemo(
    () => (art ? art.filter(artMatches) : []),
    [art, artMatches],
  );

  const onToggleArtTag = useCallback((tag: string) => {
    setArtActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const onGotoArt = useCallback((artId: string) => {
    setArtQuery('');
    setArtActiveTags(new Set());
    setArtFavOnly(false);
    setScrollToArtId(artId);
    setScrollToArtTick((t) => t + 1);
    goto('art');
  }, [goto]);
  // -------------------------------------------------------------------

  // Only your own starred events. Friends' events still show on the
  // calendar, but a "48 things on your calendar (of which 30 are yours)"
  // tab badge is just noise — the user wants a count of their own plans.
  const scheduleBadge = eventFavs.size;

  const onToggleTag = useCallback((tag: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const onClear = useCallback(() => {
    setQuery(''); setActiveTags(new Set()); setFavOnly(false); setWebOnly(false);
    setFocusKey((k) => k + 1);
  }, []);

  const onUnfavoriteAll = useCallback(() => {
    const total = campFavs.size + eventFavs.size;
    if (total === 0) return;
    const parts: string[] = [];
    if (campFavs.size) parts.push(`${campFavs.size} camp${campFavs.size === 1 ? '' : 's'}`);
    if (eventFavs.size) parts.push(`${eventFavs.size} event${eventFavs.size === 1 ? '' : 's'}`);
    const msg =
      `Remove all ${total} starred item${total === 1 ? '' : 's'} (${parts.join(', ')})?` +
      "\n\nThis can't be undone. (Friends' imported favorites are untouched.)";
    if (!confirm(msg)) return;
    campFavs.clear(); eventFavs.clear(); setFavOnly(false);
  }, [campFavs, eventFavs]);

  const onNavigate = useCallback((campId: string) => {
    setMapTargetId(campId);
    setMapArtTargetId(null);
    goto('map');
  }, [goto]);

  // Mirror of `onNavigate` for art. The Art tab's per-card "navigate ↗"
  // button calls this — it switches to the Map tab and selects the
  // art piece, just like the camps' navigate does. Distinct from
  // `onGotoArt` (which goes the OTHER way: from the map row to the
  // Art tab, scrolling to that piece's card).
  const onNavigateArt = useCallback((artId: string) => {
    setMapArtTargetId(artId);
    setMapTargetId(null);
    goto('map');
  }, [goto]);

  const onGotoCamp = useCallback((campId: string) => {
    // Clear anything that could filter the target out of view, so the
    // scroll-to actually lands on a rendered card.
    setQuery('');
    setActiveTags(new Set());
    setFavOnly(false);
    setScrollToCampId(campId);
    setScrollTick((t) => t + 1);
    goto('camps');
  }, [goto]);

  const filterNote = activeTags.size
    ? '· filters: ' + [...activeTags].join(' + ')
    : '';

  // Envelope mode (D10): show the multi-tier gate until the user
  // unlocks at least one source. Once unlocked, fall through to the
  // main app — `unlockedDeks` survives the re-render and drives the
  // source switcher's effective list.
  if (envelopeSources && !unlockedDeks) {
    return (
      <EnvelopeGate
        sources={envelopeSources}
        onUnlock={(deks, trusted) => setUnlocked({ deks, trusted })}
      />
    );
  }
  if (encEnvelope) {
    return <Gate enc={encEnvelope} onUnlock={onUnlock} />;
  }

  return (
    <>
      <div class="site-chrome">
        <Header
          campTotal={camps?.length ?? 0}
          campMatching={filtered.length}
          artTotal={art?.length ?? 0}
          artMatching={artFiltered.length}
          view={view}
          filterNote={filterNote}
          fetchedDate={meta.fetchedDate}
          fetchedAt={meta.fetchedAt}
          version={meta.version}
          currentTheme={theme}
          onThemeChange={setTheme}
          onInfoClick={() => { setInfoPulse(false); setInfoOpen(true); }}
          infoPulse={infoPulse}
          source={source}
          availableSources={effectiveAvailableSources}
          onSourceChange={setSource}
        />
        <TabBar
          view={view}
          onGoto={goto}
          scheduleBadge={scheduleBadge}
          artBadge={artFavs.size}
        />
        <ActionBar
          onShare={() => setShareOpen(true)}
          onExport={onExportSnapshot}
          onImport={onImportSnapshot}
          hasSomethingToSend={
            campFavs.size + eventFavs.size + artFavs.size + meetSpots.spots.length > 0
            || Boolean(myCampId)
          }
        />
        {embargoLifted && (
          <EmbargoLiftedBanner
            onRefresh={() => { ackEmbargoLift(); location.reload(); }}
            onDismiss={() => { ackEmbargoLift(); setEmbargoLifted(false); }}
          />
        )}
        {updateAvailable && <UpdateBanner latest={latestVersion} />}
        {pendingReleaseNotes.length > 0 && (
          <ReleaseNotesBanner
            notes={pendingReleaseNotes}
            onDismiss={dismissReleaseNotes}
          />
        )}
        {incomingShare && (
          <ImportBanner
            payload={incomingShare}
            existing={friends.friends[incomingShare.name]}
            ownNickname={readString(LS.nickname, '').trim()}
            currentSource={source}
            availableSources={availableSources}
            onSwitchSource={setSource}
            onImport={onImportFriend}
            onImportAsSelf={onImportAsSelf}
            onDismiss={onDismissImport}
          />
        )}
        {incomingSnapshot && (
          <SnapshotImportBanner
            snapshot={incomingSnapshot}
            ownNickname={readString(LS.nickname, '').trim()}
            existing={
              incomingSnapshot.nickname
                ? friends.friends[incomingSnapshot.nickname]
                : undefined
            }
            onApplySelf={onApplySnapshotSelf}
            onImportAsFriend={onImportSnapshotAsFriend}
            onDismiss={onDismissSnapshot}
          />
        )}
        {view === 'camps' && (
          <Toolbar
            query={query}
            onQueryChange={setQuery}
            onClear={onClear}
            favOnly={favOnly}
            favCount={favMatchCount}
            favCampN={campFavs.size}
            favEventN={eventFavs.size}
            onToggleFavFilter={() => setFavOnly((v) => !v)}
            webOnly={webOnly}
            webCount={webMatchCount}
            onToggleWebFilter={() => setWebOnly((v) => !v)}
            onUnfavoriteAll={onUnfavoriteAll}
            focusKey={focusKey}
          />
        )}
        {view === 'art' && (
          <>
            <div class="controls">
              <input
                type="search"
                placeholder="Search art (name, artist, description, tags…)"
                value={artQuery}
                onInput={(e) => setArtQuery((e.target as HTMLInputElement).value)}
                autocomplete="off"
              />
            </div>
            <div class="controls toolbar-row">
              <div class="filters">
                <button
                  type="button"
                  class={'fav-filter' + (artFavOnly ? ' active' : '')}
                  aria-pressed={artFavOnly ? 'true' : 'false'}
                  title={`${artFavs.size} starred art piece${artFavs.size === 1 ? '' : 's'}`}
                  onClick={() => {
                    if (!artFavOnly && artFavs.size === 0) return;
                    setArtFavOnly((v) => !v);
                  }}
                >
                  {artFavOnly ? '★' : '☆'} Favorites <span class="count">({artFavs.size})</span>
                </button>
                {(artQuery || artActiveTags.size || artFavOnly) && (
                  <button
                    type="button"
                    class="fav-filter"
                    onClick={() => {
                      setArtQuery('');
                      setArtActiveTags(new Set());
                      setArtFavOnly(false);
                    }}
                    title="Clear search + filters"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* All three views stay mounted once `camps` is loaded so tab
          switches are an instant CSS toggle, not a remount of 600
          camp cards / a fresh SVG / a fresh calendar. The one-time
          mount hit happens at first paint; everything afterward is
          O(1). The `hidden` attribute is the modern equivalent of
          `display: none` plus an aria-hidden hint for assistive tech. */}
      {camps && (
        <>
          <div hidden={view !== 'camps'}>
            <CampsView
              camps={filtered}
              total={camps.length}
              query={query}
              queryLower={queryLower}
              sortedTags={sortedTags}
              activeTags={activeTags}
              showAllTags={showAllTags}
              onToggleTag={onToggleTag}
              onToggleShowAllTags={() => setShowAllTags((v) => !v)}
              isFav={campFavs.has}
              isFavEvent={eventFavs.has}
              friendsFavingCamp={friends.friendsFavingCamp}
              friendsFavingEvent={friends.friendsFavingEvent}
              onToggleFav={campFavs.toggle}
              onToggleFavEvent={onToggleFavEvent}
              onNavigate={onNavigate}
              onRemoveFriendCampStar={(name, campId) =>
                friends.removeFriendStar(name, 'camp', campId)
              }
              onRemoveFriendEventStar={(name, eventId) =>
                friends.removeFriendStar(name, 'event', eventId)
              }
              myCampId={myCampId}
              onSetMyCamp={onSetMyCamp}
              scrollToCampId={scrollToCampId}
              scrollToCampTick={scrollTick}
            />
          </div>
          <div hidden={view !== 'schedule'}>
            <ScheduleView
              camps={camps}
              favEventIds={eventFavs.favs}
              friendFavEventIds={friends.friendsFavingEvent}
              burnStart={meta.burnStart}
              burnEnd={meta.burnEnd}
              isDayHidden={isDayHidden}
              onToggleDayHidden={toggleDayHidden}
              hiddenCount={hiddenDays.size}
              onClearHidden={hiddenDays.clear}
              onGotoCamp={onGotoCamp}
              source={source}
            />
          </div>
          <div hidden={view !== 'art'}>
            <ArtView
              art={artFiltered}
              query={artQuery}
              sortedTags={artSortedTags}
              activeTags={artActiveTags}
              showAllTags={artShowAllTags}
              onToggleTag={onToggleArtTag}
              onToggleShowAllTags={() => setArtShowAllTags((v) => !v)}
              isFav={artFavs.has}
              friendsFavingArt={friends.friendsFavingArt}
              onToggleFav={artFavs.toggle}
              onNavigate={onNavigateArt}
              onRemoveFriendStar={(name, artId) =>
                friends.removeFriendStar(name, 'art', artId)
              }
              scrollToArtId={scrollToArtId}
              scrollToArtTick={scrollToArtTick}
            />
          </div>
          <div hidden={view !== 'map'}>
            <MapView
              camps={camps}
              favCampIds={campFavs.favs}
              friendFavCampIds={friends.friendsFavingCamp}
              favEventIds={eventFavs.favs}
              friendFavEventIds={friends.friendsFavingEvent}
              art={art ?? []}
              favArtIds={artFavs.favs}
              friendFavArtIds={friends.friendsFavingArt}
              myCampId={myCampId}
              meetSpots={meetSpots.spots}
              onAddMeetSpot={meetSpots.add}
              onRemoveMeetSpot={meetSpots.removeAt}
              friendsRendezvous={friendsRendezvous}
              initialTargetId={mapTargetId}
              initialArtTargetId={mapArtTargetId}
              onClearTarget={() => {
                setMapTargetId(null);
                setMapArtTargetId(null);
              }}
              onGotoCamp={onGotoCamp}
              onGotoArt={onGotoArt}
              onRemoveFriendStar={(name, kind, id) =>
                friends.removeFriendStar(name, kind, id)
              }
              onRemoveFriendMeetSpot={(name, idx) =>
                friends.removeFriendMeetSpot(name, idx)
              }
              source={source}
            />
          </div>
        </>
      )}

      <Footer fetchedDate={meta.fetchedDate} contactEmail={meta.contactEmail} />
      <InfoModal
        open={infoOpen}
        fetchedDate={meta.fetchedDate}
        contactEmail={meta.contactEmail}
        onImport={onImportSnapshot}
        onExport={onExportSnapshot}
        onClose={() => setInfoOpen(false)}
      />
      <ShareModal
        open={shareOpen}
        campIds={[...campFavs.favs]}
        eventIds={[...eventFavs.favs]}
        artIds={[...artFavs.favs]}
        camps={camps ?? []}
        art={art ?? []}
        myCampId={myCampId}
        meetSpots={meetSpots.spots}
        source={source}
        onClose={() => setShareOpen(false)}
      />
      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        source={source}
        camps={camps ?? []}
        art={art ?? []}
        campIds={[...campFavs.favs]}
        eventIds={[...eventFavs.favs]}
        artIds={[...artFavs.favs]}
        myCampId={myCampId}
        meetSpots={meetSpots.spots}
      />
    </>
  );
}
