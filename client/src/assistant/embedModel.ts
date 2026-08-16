// Pinned config for the on-device semantic-search model (ADR 21, semantic
// rewrite). Pure + no heavy imports so it's safe in the main bundle for the
// download-gate UI and fully unit-testable.
//
// The Ask feature is entirely gated on an opt-in download of THIS model: a
// ~23 MB quantized MiniLM embedding model + the ~13 MB ONNX CPU runtime, both
// self-hosted on Cloudflare R2 (models.purohit.dev). CPU/WASM inference means
// it runs on every browser — including iPhone — with no WebGPU limits, and it
// can only ever rank real records (no hallucination).

export const MODELS_BASE = 'https://models.purohit.dev';

/** transformers.js model id + revision. Files live at
 *  `${MODELS_BASE}/${EMBED_MODEL_ID}/resolve/${EMBED_REVISION}/…` (HF layout). */
export const EMBED_MODEL_ID = 'all-MiniLM-L6-v2';
export const EMBED_REVISION = 'main';

/** Embedding dimensionality (all-MiniLM-L6-v2). */
export const EMBED_DIM = 384;

/** Full embedding-config signature. Written into the shipped vectors payload by
 *  the build (embed.mjs) and checked by the client before use — a partial
 *  upgrade (build vs client out of sync on model/revision/dtype/pooling/dim)
 *  then fails loudly instead of producing meaningless rankings. Keep the string
 *  format identical in both places. */
export const EMBED_SIG = `${EMBED_MODEL_ID}@${EMBED_REVISION} dtype=q8 pooling=mean normalize=true dim=${EMBED_DIM}`;

/** onnxruntime-web version bundled by @huggingface/transformers; its CPU wasm
 *  is self-hosted at `${MODELS_BASE}/ort/${ORT_VERSION}/`. Bump only alongside
 *  the transformers.js dep (and re-upload the wasm). */
export const ORT_VERSION = '1.26.0-dev.20260416-b7804b056c';
export const ORT_WASM_BASE = `${MODELS_BASE}/ort/${ORT_VERSION}/`;

/** One-time download disclosed to the user BEFORE they opt in (model + tokenizer
 *  + ONNX runtime + the vectors file), cached for offline reuse afterward.
 *  Rough upper bound — the browser picks an ORT wasm variant (~13–24 MB). */
export const DOWNLOAD_MB = 50;

// Note: assets are NOT runtime hash-verified — transformers.js fetches them
// internally, and R2 public buckets are read-only to the world (the primary
// tamper defense). SHA-256 provenance is recorded in the upgrade runbook
// (docs/dev/on-device-model-hosting.md), not enforced in code.
