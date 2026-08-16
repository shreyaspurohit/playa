// The opt-in "Ask" surface (ADR 21, semantic rewrite). One path: download a
// small on-device model, then search camps + art by MEANING. No model = the
// feature shows a download prompt and nothing else. On-device only; results are
// real cards ranked by an on-device vector index, never generated prose.

import { useEffect, useRef, useState } from 'preact/hooks';
import { useAssistant, type AskCorpus, type AskItem } from '../hooks/useAssistant';
import { useGeolocation } from '../hooks/useGeolocation';
import { DOWNLOAD_MB } from '../assistant/embedModel';

interface Props {
  open: boolean;
  onClose: () => void;
  corpus: AskCorpus;
  onGotoCamp: (id: string) => void;
  onGotoArt: (id: string) => void;
}

const SUGGESTIONS = [
  'coffee and chai',
  'chill lounges to relax',
  'immersive sound and music',
  'interactive fire art',
];

export function AskView({ open, onClose, corpus, onGotoCamp, onGotoArt }: Props) {
  const a = useAssistant(corpus, open);
  const geo = useGeolocation();
  const [q, setQ] = useState('');
  const [nowOnly, setNowOnly] = useState(false);
  const [nearMe, setNearMe] = useState(false);
  const lastQuery = useRef('');
  const inputRef = useRef<HTMLInputElement>(null);

  const ready = a.download.status === 'ready';
  const near = nearMe && geo.state.status === 'ready'
    ? { lat: geo.state.lat, lng: geo.state.lng }
    : null;

  const run = (query: string) => {
    const query2 = query.trim();
    lastQuery.current = query2;
    if (ready && query2) void a.ask(query2, { nowOnly, near });
  };

  useEffect(() => {
    if (open && ready) setTimeout(() => inputRef.current?.focus(), 40);
  }, [open, ready]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Re-run the last search whenever a filter (or the resolved GPS fix) changes.
  useEffect(() => {
    if (ready && lastQuery.current) void a.ask(lastQuery.current, { nowOnly, near });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowOnly, near?.lat, near?.lng, ready]);

  const submit = (e?: Event) => { e?.preventDefault(); setQ(q); run(q); };
  const runSuggestion = (s: string) => { setQ(s); run(s); };

  const toggleNear = () => {
    const next = !nearMe;
    setNearMe(next);
    if (next) {
      if (geo.state.status !== 'ready') geo.request();
    } else {
      geo.stop();   // releasing the filter must also release the GPS watch
    }
  };

  // Stop the GPS watch whenever Ask closes (the component stays mounted while
  // hidden), and reset the filter so a re-open starts clean.
  useEffect(() => {
    if (!open) { geo.stop(); setNearMe(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const gotoItem = (i: AskItem) => {
    if (i.kind === 'art') onGotoArt(i.id);
    else onGotoCamp(i.campId ?? i.id);   // events navigate to their host camp
    onClose();
  };

  return (
    <div
      class={'modal' + (open ? '' : ' modal-hidden')}
      role="dialog" aria-modal="true" aria-labelledby="ask-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div class="modal-card">
        <div class="modal-head">
          <h2 id="ask-title">🍄 Ask Not AI</h2>
          <button class="modal-close" type="button" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <p class="ask-myc">connected like mycelium — searching across everything, on your device</p>
        <div class="modal-body">
          <form class="ask-form" onSubmit={submit}>
            <input
              ref={inputRef}
              class="ask-input"
              type="search"
              placeholder={ready ? 'Ask about camps, events, food, art…' : 'Set up Ask to start…'}
              value={q}
              disabled={!ready}
              onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            />
            <button class="primary-btn" type="submit" disabled={!ready || a.loading}>
              {a.loading ? 'Searching…' : 'Ask'}
            </button>
          </form>

          {ready && (
            <>
              <div class="ask-filters">
                <button
                  type="button"
                  class={'ask-filter' + (nowOnly ? ' on' : '')}
                  aria-pressed={nowOnly}
                  onClick={() => setNowOnly((v) => !v)}
                >🕐 On now</button>
                <button
                  type="button"
                  class={'ask-filter' + (nearMe ? ' on' : '')}
                  aria-pressed={nearMe}
                  onClick={toggleNear}
                >📍 Near me</button>
                {nearMe && geo.state.status === 'requesting' && <span class="ask-filter-note">locating…</span>}
                {nearMe && (geo.state.status === 'denied' || geo.state.status === 'unavailable' || geo.state.status === 'error') && (
                  <span class="ask-filter-note">location off</span>
                )}
              </div>
              <div class="ask-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" class="ask-chip" onClick={() => runSuggestion(s)}>{s}</button>
                ))}
              </div>
            </>
          )}

          {!a.available && (
            <p class="ask-note">Ask isn’t available in this build.</p>
          )}

          {a.available && !ready && (
            <div class="ask-download">
              {(a.download.status === 'idle') && (
                <>
                  <p class="ask-dl-lead">
                    Ask a plain-English question and get the camps, events, and art
                    that fit — try “where can I relax” or “late-night music.”
                  </p>
                  <button type="button" class="primary-btn ask-dl-btn" onClick={() => a.startDownload()}>
                    Set up Ask Not AI · ≈{DOWNLOAD_MB} MB
                  </button>
                  <p class="ask-dl-fine">
                    One-time download, then it works offline.
                  </p>
                </>
              )}
              {a.download.status === 'loading' && (
                <div class="ask-dl-progress" role="status" aria-live="polite">
                  <div class="ask-dl-bar"><div class="ask-dl-fill" style={{ width: `${Math.round(a.download.progress * 100)}%` }} /></div>
                  <p class="ask-dl-status">Downloading model — {Math.round(a.download.progress * 100)}%</p>
                  {a.download.text && <p class="ask-dl-fine">{a.download.text}</p>}
                </div>
              )}
              {a.download.status === 'error' && (
                <div class="ask-dl-error">
                  <p>{a.download.error}</p>
                  <button type="button" class="ask-dl-link" onClick={() => a.startDownload()}>Try again</button>
                </div>
              )}
            </div>
          )}

          {ready && a.facts.length > 0 && <p class="ask-answer">{a.facts.join(' ')}</p>}

          {ready && a.items.length > 0 && (
            <ul class="ask-results">
              {a.items.map((i) => (
                <li key={i.kind + i.id}>
                  <button type="button" class="ask-result" onClick={() => gotoItem(i)}>
                    <span class="ask-result-kind">{i.kind === 'art' ? '🎨' : i.kind === 'event' ? '📅' : '🏕'}</span>
                    <span class="ask-result-body">
                      <span class="ask-result-title">
                        {i.faved && <span class="ask-result-star" aria-label="starred">★</span>}
                        {i.title}
                        {i.timing && (
                          <span class={'ask-timing ' + i.timing}>
                            {i.timing === 'now' ? 'on now' : 'starting soon'}
                          </span>
                        )}
                      </span>
                      {(i.subtitle || i.distance) && (
                        <span class="ask-result-sub">
                          {i.distance && <span class="ask-result-dist">{i.distance}</span>}
                          {i.distance && i.subtitle ? ' · ' : ''}
                          {i.subtitle}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p class="ask-disclaimer">
            Runs entirely on your device.
          </p>
        </div>
      </div>
    </div>
  );
}
