// Downloadable WebGPU model backend (ADR 21 D3.2 / D6). Phase 2.
//
// This module STATICALLY imports @mlc-ai/web-llm, so it is the code-split
// boundary: it is built as a SEPARATE ESM file (`webllm-backend.js`, see
// esbuild.config.mjs) and loaded by the main app via a runtime dynamic
// `import()` ONLY after the user opts into the download. The ~1-2 MB of
// web-llm therefore never ships in the inlined main bundle.
//
// The weights + wasm libs are self-hosted on R2 (models.purohit.dev). Before
// the runtime instantiates anything, the wasm *library* bytes are verified
// against the SHA-256 pinned in modelCatalog.ts (D6 integrity): a mismatch
// fails closed. Weight shards are inert data (not executable) and are cached
// by web-llm's own Cache-API storage for offline reuse on playa.

import { CreateMLCEngine, type MLCEngineInterface, type InitProgressReport } from '@mlc-ai/web-llm';
import type { AssistantBackend } from './session';
import { SYSTEM_PROMPT, buildPrompt } from './session';
import { matchesSha256 } from './integrity';
import { WEBLLM_VERSION, modelLibUrl, modelUrl, type CatalogModel } from './modelCatalog';

export interface LoadProgress {
  /** 0..1 overall progress reported by web-llm (download + compile). */
  progress: number;
  /** Human-readable status line from web-llm ("Fetching param…"). */
  text: string;
}

/** Fetch the model's wasm library and verify it against the pinned hash (D6).
 *  Populates the HTTP cache so web-llm's own subsequent fetch is free. Throws
 *  (fail closed) if the origin, bytes, or hash don't match. */
export async function verifyModelLib(model: CatalogModel): Promise<void> {
  const url = modelLibUrl(model);
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`model library fetch failed (${res.status})`);
  const bytes = await res.arrayBuffer();
  if (!(await matchesSha256(bytes, model.libSha256))) {
    throw new Error(`model library integrity check failed for ${model.id}`);
  }
}

/** WebLLM appConfig pointing weights + lib at our self-hosted origin only. */
function appConfigFor(model: CatalogModel) {
  return {
    useIndexedDBCache: false, // Cache-API storage (default) for offline reuse
    model_list: [{
      model: modelUrl(model),
      model_id: model.id,
      model_lib: modelLibUrl(model),
      vram_required_MB: model.vramMB,
      low_resource_required: model.vramMB < 1500,
    }],
  };
}

function wrapEngine(engine: MLCEngineInterface): AssistantBackend {
  return {
    async ask(question, context, signal) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const onAbort = () => { try { void engine.interruptGenerate(); } catch { /* ignore */ } };
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        const reply = await engine.chat.completions.create({
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildPrompt(question, context) },
          ],
          temperature: 0.3,
          max_tokens: 512,
          stream: false,
        });
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        return reply.choices[0]?.message?.content ?? '';
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    },
    dispose() {
      // Frees GPU buffers + weights (D2 foreground-only). Re-load reads from
      // the Cache API — no re-download, just recompile.
      void engine.unload().catch(() => { /* ignore */ });
    },
  };
}

/** Verify integrity, download+compile (reporting progress), and return a
 *  foreground-only backend. Rejects if the wasm pin fails or the model OOMs. */
export async function loadWebllmModel(
  model: CatalogModel,
  onProgress?: (p: LoadProgress) => void,
): Promise<AssistantBackend> {
  await verifyModelLib(model);
  const engine = await CreateMLCEngine(model.id, {
    appConfig: appConfigFor(model),
    initProgressCallback: (r: InitProgressReport) => onProgress?.({ progress: r.progress, text: r.text }),
  });
  return wrapEngine(engine);
}

export const WEBLLM_BUILD_VERSION = WEBLLM_VERSION;
