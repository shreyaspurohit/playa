// Access the shipped semantic-search vectors (ADR 21). Availability is a cheap
// meta-tag check; the actual ~4 MB vectors live in a SEPARATE `embeddings.json`
// fetched only when the user opts into the model download — so the page stays
// small for everyone who never opens Ask.

import type { EmbeddingsPayload } from './semanticLoader';

/** Did this build ship a search index? (cheap — reads a meta tag). */
export function hasEmbeddings(): boolean {
  const el = document.querySelector('meta[name="bm-embeddings"]');
  return el?.getAttribute('content') === '1';
}

/** Fetch the vectors file. Same-origin (SW runtime-caches it); the server
 *  serves it gzipped and the browser inflates transparently. */
export async function fetchEmbeddings(): Promise<EmbeddingsPayload | null> {
  try {
    const url = new URL('embeddings.json', document.baseURI).href;
    const res = await fetch(url);
    if (!res.ok) return null;
    const payload = await res.json() as EmbeddingsPayload;
    return payload && Array.isArray(payload.keys) ? payload : null;
  } catch {
    return null;
  }
}
