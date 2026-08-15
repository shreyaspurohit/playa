// On-device assistant capability detection (ADR 21 D3/D5).
//
// Resolves which backend tier the current platform can offer — never by
// user-agent sniffing, always by feature probe. Phase 1 uses two tiers:
//   - 'builtin'        → the browser exposes an on-device LLM (Chrome/Chromium
//                        `LanguageModel` / Prompt API, Gemini Nano).
//   - 'retrieval-only' → no built-in model; answer from structured retrieval.
// `webgpuDownloadPossible` is reported separately so the UI can hint at the
// phase-2 downloadable-model tier without implying it exists yet (ADR 21 D6/D8).

export type AssistantTier = 'builtin' | 'retrieval-only';

export interface Capabilities {
  tier: AssistantTier;
  builtinModel: boolean;
  webgpuDownloadPossible: boolean;
}

/** The Chromium built-in Prompt API surface, feature-probed at runtime. */
interface LanguageModelStatic {
  availability?: () => Promise<string>;
  create?: (opts?: unknown) => Promise<unknown>;
}

export function builtinLanguageModel(): LanguageModelStatic | null {
  const g = globalThis as unknown as { LanguageModel?: LanguageModelStatic };
  const lm = g.LanguageModel;
  return lm && typeof lm.create === 'function' ? lm : null;
}

export function hasWebGpu(): boolean {
  return typeof navigator !== 'undefined'
    && 'gpu' in navigator
    && !!(navigator as unknown as { gpu?: unknown }).gpu;
}

interface GpuAdapterLike { features?: { has?: (name: string) => boolean } }
interface GpuLike { requestAdapter?: (opts?: unknown) => Promise<GpuAdapterLike | null> }

/** Whether an adapter that can actually run our q4f16 models is obtainable:
 *  WebGPU present AND the adapter reports the `shader-f16` feature. We probe
 *  this BEFORE offering the ~600 MB download, so a device whose WebGPU lacks
 *  f16 (some Safari/Firefox/GPU combos) never gets invited into a doomed
 *  download that would only fall back to smart search. Presence of
 *  `navigator.gpu` alone is not enough — f16 is the real gate. */
export async function webgpuCanRunF16(): Promise<boolean> {
  const gpu = typeof navigator !== 'undefined'
    ? (navigator as unknown as { gpu?: GpuLike }).gpu
    : undefined;
  if (!gpu || typeof gpu.requestAdapter !== 'function') return false;
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return false;
    return !!adapter.features && typeof adapter.features.has === 'function'
      && adapter.features.has('shader-f16');
  } catch {
    return false;
  }
}

/** Coarse form-factor + memory hint for sizing the downloadable model (D5).
 *  `deviceMemory` is Chrome-only (GB, capped at 8); undefined elsewhere. */
export function deviceHint(): { mobile: boolean; deviceMemoryGB?: number } {
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as
    | (Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } })
    | undefined;
  let mobile = false;
  if (nav?.userAgentData && typeof nav.userAgentData.mobile === 'boolean') {
    mobile = nav.userAgentData.mobile;
  } else if (typeof nav?.userAgent === 'string') {
    mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent);
  }
  return { mobile, deviceMemoryGB: nav?.deviceMemory };
}

/** Probe the built-in model and WebGPU, then classify the usable tier. */
export async function detectCapabilities(): Promise<Capabilities> {
  const lm = builtinLanguageModel();
  let builtinModel = false;
  if (lm) {
    if (lm.availability) {
      try {
        const a = await lm.availability();
        // 'available' | 'downloadable' | 'downloading' all mean the browser can
        // give us the model; 'unavailable' means it cannot.
        builtinModel = a !== 'unavailable' && a !== 'no';
      } catch {
        builtinModel = false;
      }
    } else {
      builtinModel = true; // create() exists but no availability() — assume usable
    }
  }
  // Only probe the GPU when there's no built-in model to fall through to, and
  // require real f16 capability — not just `navigator.gpu` — before offering.
  const webgpuDownloadPossible = builtinModel ? false : await webgpuCanRunF16();
  return {
    builtinModel,
    webgpuDownloadPossible,
    tier: builtinModel ? 'builtin' : 'retrieval-only',
  };
}
