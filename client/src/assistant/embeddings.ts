// Access the shipped semantic-search vectors (ADR 21). Availability is a cheap
// meta-tag check; the actual vectors live in SEPARATE per-source files
// (`embeddings-<source>.json`) fetched only when the user opts into the model
// download — and only for the year being viewed (ADR 21 D9) — so the page stays
// small for everyone who never opens Ask, and a multi-year (demigod/god) user
// downloads only the index they actually search.

import type { EmbeddingsPayload } from './semanticLoader';

/** Sources this build shipped a search index for (cheap — reads a meta tag).
 *  The build lists them current-year-first in `<meta name="bm-embeddings">`. */
export function embeddingsSources(): string[] {
  const el = document.querySelector('meta[name="bm-embeddings"]');
  const raw = (el?.getAttribute('content') ?? '').trim();
  return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

/** Did this build ship a search index for `source`? */
export function hasEmbeddings(source: string): boolean {
  return embeddingsSources().includes(source);
}

/** Fetch one source's vectors file. Same-origin (SW runtime-caches it); the
 *  server serves it gzipped and the browser inflates transparently. */
export async function fetchEmbeddings(source: string): Promise<EmbeddingsPayload | null> {
  try {
    const url = new URL(`embeddings-${source}.json`, document.baseURI).href;
    const res = await fetch(url);
    if (!res.ok) return null;
    const payload = await res.json() as EmbeddingsPayload;
    return payload && Array.isArray(payload.keys) ? payload : null;
  } catch {
    return null;
  }
}
