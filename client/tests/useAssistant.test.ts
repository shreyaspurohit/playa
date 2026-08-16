// Regression tests for the Ask download lifecycle (ADR 21), focused on the
// generation guard: closing Ask mid-download must NOT leave it falsely "ready".
// The heavy transformers.js chunk is injected via AssistantDeps so the hook runs
// under happy-dom with no real model.
import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { h, render } from 'preact';
import { installDom, teardownDom } from './_dom';
import { useAssistant, type AssistantController, type AssistantDeps, type AskCorpus } from '../src/hooks/useAssistant';
import type { Embedder } from '../src/assistant/semanticLoader';
import type { Camp } from '../src/types';

const READY_FLAG = 'bm-ai-model-ready';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const CORPUS: AskCorpus = {
  source: 't',
  camps: [{ id: '1', name: 'X', description: '', website: '', url: '', location: '', tags: [], events: [] } as unknown as Camp],
  art: [],
  campFavs: new Set(), eventFavs: new Set(), artFavs: new Set(),
};

let controller: AssistantController | null = null;
let mp: HTMLElement;
let deps: AssistantDeps;
let embedder: ReturnType<typeof deferred<Embedder>>;
let disposed = false;

function Harness({ active }: { active: boolean }) {
  controller = useAssistant(CORPUS, active, deps);
  return null;
}
const draw = (active: boolean) => render(h(Harness, { active }), mp);
// Preact flushes effects via rAF with a 100ms setTimeout fallback; wait past it
// so the close effect's generation bump runs before we resolve the embedder.
const flush = async () => { await new Promise((r) => setTimeout(r, 130)); await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => {
  installDom();
  localStorage.clear();   // isolate the ready-flag between tests
  mp = document.createElement('div');
  document.body.appendChild(mp);
  disposed = false;
  embedder = deferred<Embedder>();
  deps = {
    hasEmbeddings: () => true,
    fetchEmbeddings: async () => ({ model: 'all-MiniLM-L6-v2', dim: 3, q: 'int8', sig: 'x', keys: ['t:camp:1'], data: '' }),
    loadBackend: async () => ({
      loadEmbedder: async () => embedder.promise,          // stays pending until the test resolves it
      buildIndex: async () => ({} as never),
      searchIndex: async () => [],
    }),
  };
});
afterEach(() => {
  try { render(null, mp); } catch { /* ignore */ }
  teardownDom();
  controller = null;
});

const mockEmbedder = (): Embedder => ({ embed: async () => new Float32Array(3), dispose: async () => { disposed = true; } });

describe('useAssistant download lifecycle (ADR 21)', () => {
  test('a completed download transitions to ready and sets the cache flag', async () => {
    draw(true);
    await flush();
    controller!.startDownload();
    await flush();
    assert.equal(controller!.download.status, 'loading');
    embedder.resolve(mockEmbedder());   // finish the download (no close)
    await flush();
    assert.equal(controller!.download.status, 'ready');
    assert.equal(localStorage.getItem(READY_FLAG), '1');
  });

  test('closing Ask mid-download must NOT leave it falsely ready', async () => {
    draw(true);
    await flush();
    controller!.startDownload();
    await flush();
    assert.equal(controller!.download.status, 'loading');

    draw(false);                        // close while the embedder is still loading
    await flush();
    embedder.resolve(mockEmbedder());   // the in-flight load now resolves — but the gen changed
    await flush();

    assert.equal(controller!.download.status, 'idle', 'a cancelled load must not become ready');
    assert.equal(localStorage.getItem(READY_FLAG), null, 'the ready flag must not be set on cancellation');
    assert.equal(disposed, true, 'the embedder from the cancelled load must be disposed');
  });
});
