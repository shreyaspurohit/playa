// Pinned catalog for the downloadable on-device model tier (ADR 21 D6).
//
// Everything here is DATA the app trusts because it deploys through the CI →
// Pages path: the exact WebLLM version, the self-hosted R2 origin, and — for
// each model — the download size disclosed up front, the WebGPU VRAM the model
// needs, and a SHA-256 pin of its wasm *library* (the one piece that is actual
// executable code; the weight shards are inert data, see D6). The backend
// verifies the wasm bytes against these pins before instantiating anything, so
// integrity is anchored in the app, not in the bucket.
//
// Pure + no imports: fully unit-testable, and safe to pull into the small main
// bundle for capability/UI gating without dragging in the heavy web-llm chunk.

/** WebLLM release the bundled runtime + these wasm libs are built for. The
 *  wasm libs live under `${MODELS_BASE}/libs/${WEBLLM_VERSION}/`. Bump this
 *  (and re-upload libs + re-pin hashes) only alongside the npm dep bump. */
export const WEBLLM_VERSION = 'v0_2_84';

/** Self-hosted, public-read R2 origin (custom domain). Also the single host
 *  added to the CSP `connect-src`. Read-only to the world by construction. */
export const MODELS_BASE = 'https://models.purohit.dev';

export interface CatalogModel {
  /** WebLLM `model_id`; also the R2 folder name holding the weight shards. */
  id: string;
  /** Short human label for the download UI. */
  label: string;
  /** wasm library filename under `libs/${WEBLLM_VERSION}/`. */
  libFile: string;
  /** Lowercase hex SHA-256 of the wasm library bytes (integrity pin, D6). */
  libSha256: string;
  /** Download footprint of the weight folder, MB (disclosed BEFORE download). */
  downloadMB: number;
  /** WebGPU memory the loaded model needs, MB — used to gate device fit. */
  vramMB: number;
}

/** The three reviewed models, smallest-footprint first. */
export const CATALOG: readonly CatalogModel[] = [
  {
    id: 'gemma3-1b-it-q4f16_1-MLC',
    label: 'Gemma 3 1B',
    libFile: 'gemma3-1b-it-q4f16_1_cs1k-webgpu.wasm',
    libSha256: 'c608d6eb62de3b7dd7444d3d48088f073e3b68a719dfe77e111efac70dd2e165',
    downloadMB: 574,
    vramMB: 711,
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 1B',
    libFile: 'Llama-3.2-1B-Instruct-q4f16_1_cs1k-webgpu.wasm',
    libSha256: '2aa9b5f0c8de532f6cbf6bb7b863aaa02645bf6fff856083b202f968712d3f92',
    downloadMB: 672,
    vramMB: 879,
  },
  {
    id: 'Qwen3-1.7B-q4f16_1-MLC',
    label: 'Qwen3 1.7B',
    libFile: 'Qwen3-1.7B-q4f16_1_cs1k-webgpu.wasm',
    libSha256: '8161aaa4b40bccf19fcedb2f2e8c221eb9efb72d2198681f1958c9c1e05a682f',
    downloadMB: 939,
    vramMB: 2037,
  },
] as const;

export function modelById(id: string): CatalogModel | undefined {
  return CATALOG.find((m) => m.id === id);
}

/** Absolute URL of a model's weight folder (WebLLM `model`). */
export function modelUrl(m: CatalogModel): string {
  return `${MODELS_BASE}/${m.id}`;
}

/** Absolute URL of a model's wasm library (WebLLM `model_lib`). */
export function modelLibUrl(m: CatalogModel): string {
  return `${MODELS_BASE}/libs/${WEBLLM_VERSION}/${m.libFile}`;
}

/** What the current device can be offered. `deviceMemoryGB` is
 *  `navigator.deviceMemory` (Chrome-only; undefined elsewhere). `mobile` is a
 *  coarse form-factor hint. Kept deliberately conservative: phones only get
 *  ~1B models (ADR D5 — larger ones OOM-kill the tab under iOS's per-tab cap),
 *  and the recommended default scales with available memory. */
export interface DeviceHint {
  mobile: boolean;
  deviceMemoryGB?: number;
}

export interface ModelOffer {
  /** Recommended default for this device. */
  recommended: CatalogModel;
  /** All models offered (recommended included), smallest first. Phones exclude
   *  the 1.7B model; it needs ~2 GB VRAM and reliably OOMs mobile tabs. */
  options: CatalogModel[];
}

const GEMMA = CATALOG[0];
const LLAMA = CATALOG[1];
const QWEN = CATALOG[2];

export function offerFor(hint: DeviceHint): ModelOffer {
  if (hint.mobile) {
    // Phones: 1B only. Default to the lighter Gemma when memory is unknown or
    // low, otherwise the slightly stronger Llama.
    const recommended = (hint.deviceMemoryGB ?? 0) >= 6 ? LLAMA : GEMMA;
    return { recommended, options: [GEMMA, LLAMA] };
  }
  // Desktop/laptop: offer the 1.7B when there's clearly enough memory.
  const recommended = (hint.deviceMemoryGB ?? 8) >= 8 ? QWEN : LLAMA;
  return { recommended, options: [GEMMA, LLAMA, QWEN] };
}
