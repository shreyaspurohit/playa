// Assistant state (ADR 21). Ties capability detection + retrieval grounding +
// the foreground-only session into UI state. A generative answer comes from the
// browser's built-in model (tier 1) or, when the user opts in, a downloaded
// WebGPU model (tier 2); otherwise the answer is a deterministic summary of the
// retrieved records (tier 3). Everything is on-device.

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { detectCapabilities, deviceHint, type AssistantTier } from '../assistant/capabilities';
import { retrieve, type AskCorpus, type GroundingItem, type JournalNote, type Retrieval } from '../assistant/retrieval';
import { AssistantSession, createBuiltinBackend } from '../assistant/session';
import { offerFor, type CatalogModel, type ModelOffer } from '../assistant/modelCatalog';
import { loadWebgpuBackend } from '../assistant/webllmLoader';
import { loadDocument } from '../utils/journalDb';
import { activeEntries } from '../utils/journalStore';

/** The corpus the caller supplies (camps/art/favorites). The hook adds the
 *  user's journal notes from IndexedDB on its own. */
export type BaseCorpus = Omit<AskCorpus, 'journal'>;

export type DownloadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface DownloadState {
  status: DownloadStatus;
  progress: number;        // 0..1
  text: string;            // web-llm status line
  error: string | null;
  model: CatalogModel | null;
}

export interface AssistantController {
  ready: boolean;
  tier: AssistantTier;
  webgpuDownloadPossible: boolean;
  offer: ModelOffer | null;      // downloadable models for this device (tier 2)
  download: DownloadState;
  loading: boolean;
  answer: string | null;
  items: GroundingItem[];
  facts: string[];
  error: string | null;
  ask: (question: string) => Promise<void>;
  startDownload: (model: CatalogModel) => void;
  reset: () => void;
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

/** A readable answer built purely from retrieval, no model (ADR 21 D3 tier 3). */
function retrievalSummary(r: Retrieval): string {
  if (r.items.length === 0) return "I couldn't find anything matching that in the current data.";
  const lead = r.facts.join(' ');
  const names = r.items.slice(0, 5).map((i) => i.title).join(', ');
  return `${lead} Top matches: ${names}.`;
}

const IDLE_DOWNLOAD: DownloadState = { status: 'idle', progress: 0, text: '', error: null, model: null };

export function useAssistant(base: BaseCorpus, active: boolean): AssistantController {
  const [ready, setReady] = useState(false);
  const [tier, setTier] = useState<AssistantTier>('retrieval-only');
  const [webgpuDownloadPossible, setWebgpu] = useState(false);
  const [offer, setOffer] = useState<ModelOffer | null>(null);
  const [download, setDownload] = useState<DownloadState>(IDLE_DOWNLOAD);
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [items, setItems] = useState<GroundingItem[]>([]);
  const [facts, setFacts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Keep the latest corpus (camps/art/favs from props + journal from IndexedDB)
  // without re-detecting or re-binding `ask`.
  const journalRef = useRef<JournalNote[]>([]);
  const corpusRef = useRef<AskCorpus>({ ...base, journal: journalRef.current });
  corpusRef.current = { ...base, journal: journalRef.current };
  const sessionRef = useRef<AssistantSession | null>(null);
  const detectedRef = useRef(false);

  // Pull the user's own journal notes into the corpus when the surface opens.
  // Private and on-device — the assistant is on-device too, so nothing leaves.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void loadDocument()
      .then((doc) => {
        if (cancelled) return;
        journalRef.current = activeEntries(doc).map((e) => ({
          id: e.entryId, title: e.value?.title ?? '', text: e.value?.text ?? '',
        }));
      })
      .catch(() => { if (!cancelled) journalRef.current = []; });
    return () => { cancelled = true; };
  }, [active]);

  // Detect capabilities the first time the surface is opened (never at boot).
  useEffect(() => {
    if (!active || detectedRef.current) return;
    detectedRef.current = true;
    let cancelled = false;
    void detectCapabilities().then((c) => {
      if (cancelled) return;
      setTier(c.tier);
      setWebgpu(c.webgpuDownloadPossible);
      if (c.tier === 'builtin') sessionRef.current = new AssistantSession(createBuiltinBackend);
      else if (c.webgpuDownloadPossible) setOffer(offerFor(deviceHint()));
      setReady(true);
    });
    return () => { cancelled = true; };
  }, [active]);

  // Foreground-only (D2): free the model when the tab is hidden or the surface
  // closes, and on unmount. No background inference ever.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'hidden') sessionRef.current?.release(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); sessionRef.current?.release(); };
  }, []);
  useEffect(() => { if (!active) sessionRef.current?.release(); }, [active]);

  // Opt-in download of a WebGPU model (tier 2). Size is disclosed on the button
  // BEFORE this runs. The model is verified (wasm hash pin), downloaded, and
  // compiled with progress; on success it becomes the session backend.
  const startDownload = useCallback((model: CatalogModel) => {
    setDownload({ status: 'loading', progress: 0, text: 'Starting…', error: null, model });
    const session = new AssistantSession(() => loadWebgpuBackend(model, (p) => {
      setDownload((d) => (d.model?.id === model.id && d.status === 'loading'
        ? { ...d, progress: p.progress, text: p.text }
        : d));
    }));
    sessionRef.current?.release();
    sessionRef.current = session;
    void session.prewarm()
      .then(() => setDownload((d) => (d.model?.id === model.id
        ? { ...d, status: 'ready', progress: 1 }
        : d)))
      .catch((e) => {
        sessionRef.current = null;
        setDownload({ status: 'error', progress: 0, text: '', model,
          error: e instanceof Error ? e.message : 'The model could not be loaded on this device.' });
      });
  }, []);

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q) return;
    setError(null);
    setAnswer(null);
    const r = retrieve(q, corpusRef.current);
    setItems(r.items);
    setFacts(r.facts);

    if (sessionRef.current) {
      setLoading(true);
      try {
        const text = await sessionRef.current.ask(q, r.contextText);
        setAnswer(text.trim() || retrievalSummary(r));
      } catch (e) {
        if (isAbort(e)) return;            // backgrounded mid-answer — leave results shown
        // Model failed to load/run (e.g. iOS memory) → fall back to retrieval.
        setAnswer(retrievalSummary(r));
      } finally {
        setLoading(false);
      }
    } else {
      setAnswer(retrievalSummary(r));
    }
  }, []);

  const reset = useCallback(() => {
    setAnswer(null); setItems([]); setFacts([]); setError(null);
  }, []);

  return {
    ready, tier, webgpuDownloadPossible, offer, download, loading,
    answer, items, facts, error, ask, startDownload, reset,
  };
}
