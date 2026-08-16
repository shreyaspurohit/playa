// Downloadable semantic-search backend (ADR 21, semantic rewrite). Phase 2.
//
// This module STATICALLY imports @huggingface/transformers + @orama/orama, so
// it is the code-split boundary: built as a SEPARATE ESM file
// (`semantic-backend.js`) and loaded by the main app via a runtime dynamic
// import ONLY after the user opts into the ~35 MB model download. It:
//   1. loads the MiniLM embedder (weights + ONNX CPU runtime from R2),
//   2. builds an Orama vector index from the shipped record vectors,
//   3. embeds a query and ranks real records by meaning — no hallucination.
// CPU/WASM only, so it runs on every browser (incl. iOS) with no WebGPU limits.

import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { create, insertMultiple, search, type AnyOrama } from '@orama/orama';
import { EMBED_MODEL_ID, EMBED_REVISION, EMBED_SIG, MODELS_BASE, ORT_WASM_BASE } from './embedModel';
import { decodeVectors } from './vectors';

export interface LoadProgress { progress: number; text: string }
export type Embed = (text: string) => Promise<Float32Array>;
/** The embedder + an explicit disposer that releases the ONNX session. */
export interface Embedder { embed: Embed; dispose: () => Promise<void> }
export interface EmbeddingsPayload { model: string; dim: number; q: string; sig?: string; keys: string[]; data: string }
export type SearchDb = AnyOrama;
export interface Hit { key: string; score: number }

/** Point transformers.js at our self-hosted assets and force single-threaded
 *  CPU WASM (no SharedArrayBuffer / COOP-COEP needed → works on GitHub Pages). */
function configureEnv(): void {
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.remoteHost = MODELS_BASE;
  env.remotePathTemplate = '{model}/resolve/{revision}/';
  const wasm = (env.backends as { onnx: { wasm: { numThreads: number; wasmPaths: string } } }).onnx.wasm;
  wasm.numThreads = 1;
  wasm.wasmPaths = ORT_WASM_BASE;
}

/** Download + init the embedder (reports progress). Returns an embed fn plus an
 *  explicit `dispose()` — nulling the closure alone would NOT release the ONNX
 *  session, so callers must call this when done. */
export async function loadEmbedder(onProgress?: (p: LoadProgress) => void): Promise<Embedder> {
  configureEnv();
  const extractor = await pipeline('feature-extraction', EMBED_MODEL_ID, {
    revision: EMBED_REVISION,
    dtype: 'q8',        // → onnx/model_quantized.onnx (the file we self-host)
    device: 'wasm',
    progress_callback: (p: { status?: string; file?: string; progress?: number }) => {
      onProgress?.({ progress: typeof p.progress === 'number' ? p.progress / 100 : 0, text: p.file || p.status || '' });
    },
  }) as FeatureExtractionPipeline;
  return {
    embed: async (text: string) => {
      const out = await extractor(text || '', { pooling: 'mean', normalize: true });
      return out.data as Float32Array;
    },
    dispose: async () => { try { await extractor.dispose(); } catch { /* already gone */ } },
  };
}

/** Build an Orama vector index over only the records the client actually has
 *  (a locked/undisclosed source's vectors are shipped but skipped here).
 *  Rejects if the vectors were built with a different model config (D#4). */
export async function buildIndex(p: EmbeddingsPayload, allow: (key: string) => boolean): Promise<SearchDb> {
  if (p.sig !== EMBED_SIG) {
    throw new Error(`search index model mismatch (built "${p.sig ?? 'unknown'}", expected "${EMBED_SIG}")`);
  }
  const keys = p.keys;
  const vecs = decodeVectors(p.data, p.dim, keys.length);
  const db = await create({ schema: { key: 'string', embedding: `vector[${p.dim}]` } });
  const docs: { key: string; embedding: number[] }[] = [];
  for (let i = 0; i < keys.length; i++) {
    if (allow(keys[i])) docs.push({ key: keys[i], embedding: Array.from(vecs[i]) });
  }
  if (docs.length) await insertMultiple(db, docs);
  return db;
}

export async function searchIndex(db: SearchDb, queryVec: Float32Array, limit: number): Promise<Hit[]> {
  const res = await search(db, {
    mode: 'vector',
    vector: { value: Array.from(queryVec), property: 'embedding' },
    similarity: 0,
    limit,
  });
  return res.hits.map((h) => ({ key: String((h.document as unknown as { key: string }).key), score: h.score }));
}
