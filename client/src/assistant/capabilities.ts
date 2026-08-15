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
  return {
    builtinModel,
    webgpuDownloadPossible: !builtinModel && hasWebGpu(),
    tier: builtinModel ? 'builtin' : 'retrieval-only',
  };
}
