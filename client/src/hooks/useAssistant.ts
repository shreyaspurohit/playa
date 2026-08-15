// Assistant state (ADR 21). Ties capability detection + retrieval grounding +
// the foreground-only session into UI state. A generative answer is produced
// only when the platform has a built-in on-device model; otherwise the answer
// is a deterministic summary of the retrieved records. Everything is on-device.

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { detectCapabilities, type AssistantTier } from '../assistant/capabilities';
import { retrieve, type AskCorpus, type GroundingItem, type Retrieval } from '../assistant/retrieval';
import { AssistantSession, createBuiltinBackend } from '../assistant/session';

export interface AssistantController {
  ready: boolean;
  tier: AssistantTier;
  webgpuDownloadPossible: boolean;
  loading: boolean;
  answer: string | null;
  items: GroundingItem[];
  facts: string[];
  error: string | null;
  ask: (question: string) => Promise<void>;
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

export function useAssistant(corpus: AskCorpus, active: boolean): AssistantController {
  const [ready, setReady] = useState(false);
  const [tier, setTier] = useState<AssistantTier>('retrieval-only');
  const [webgpuDownloadPossible, setWebgpu] = useState(false);
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [items, setItems] = useState<GroundingItem[]>([]);
  const [facts, setFacts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Keep the latest corpus without re-detecting or re-binding `ask`.
  const corpusRef = useRef(corpus);
  corpusRef.current = corpus;
  const sessionRef = useRef<AssistantSession | null>(null);
  const detectedRef = useRef(false);

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

  return { ready, tier, webgpuDownloadPossible, loading, answer, items, facts, error, ask, reset };
}
