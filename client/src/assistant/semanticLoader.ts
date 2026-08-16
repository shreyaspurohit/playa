// Runtime loader for the code-split semantic backend (ADR 21). Lives in the
// MAIN bundle; pulls in `semantic-backend.js` (transformers.js + orama) via a
// dynamic import with a RUNTIME-computed specifier so esbuild leaves it
// external — the heavy libs never fold into the inlined main bundle and load
// only when the user opts into the model download.

import type { Embed, Embedder, EmbeddingsPayload, SearchDb, Hit, LoadProgress } from './semantic';

export type { Embed, Embedder, EmbeddingsPayload, SearchDb, Hit, LoadProgress };

interface SemanticModule {
  loadEmbedder: (onProgress?: (p: LoadProgress) => void) => Promise<Embedder>;
  buildIndex: (p: EmbeddingsPayload, allow: (key: string) => boolean) => Promise<SearchDb>;
  searchIndex: (db: SearchDb, queryVec: Float32Array, limit: number) => Promise<Hit[]>;
}

const BACKEND_FILE = 'semantic-backend.js';

export async function loadSemanticBackend(): Promise<SemanticModule> {
  const url = new URL(BACKEND_FILE, document.baseURI).href;   // non-literal → external
  return import(url) as Promise<SemanticModule>;
}
