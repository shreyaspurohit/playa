// Foreground-only assistant session (ADR 21 D2).
//
// The whole point: a model backend is created LAZILY on the first question and
// RELEASED the moment the app is backgrounded, so there is never idle GPU/CPU
// or memory cost. `AssistantSession` owns that lifecycle; the hook calls
// `release()` on `visibilitychange → hidden` and on unmount. No service-worker
// inference, no wake-locks, no timers.

import { builtinLanguageModel } from './capabilities';

/** A backend answers a grounded question. Implemented by the built-in model
 *  today; a WebGPU-download backend (phase 2) plugs in behind the same shape. */
export interface AssistantBackend {
  ask(question: string, context: string, signal: AbortSignal): Promise<string>;
  dispose(): void;
}

const SYSTEM_PROMPT =
  'You are a helpful assistant inside an unofficial Burning Man camp-directory app. '
  + 'Answer ONLY from the provided context records about camps, events, and art. '
  + 'If the context does not contain the answer, say you could not find it in the data. '
  + 'Be concise, reference items by name, and never invent camps, times, or locations.';

function buildPrompt(question: string, context: string): string {
  return `Context records:\n${context}\n\nQuestion: ${question}\n\nAnswer from the context only:`;
}

/** Chromium built-in Prompt API (`LanguageModel`) backend. */
export async function createBuiltinBackend(): Promise<AssistantBackend> {
  const lm = builtinLanguageModel();
  if (!lm || !lm.create) throw new Error('No built-in language model available.');
  const session = await lm.create({
    initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
  }) as { prompt: (t: string, o?: { signal?: AbortSignal }) => Promise<string>; destroy?: () => void };
  return {
    async ask(question, context, signal) {
      return session.prompt(buildPrompt(question, context), { signal });
    },
    dispose() {
      try { session.destroy?.(); } catch { /* ignore */ }
    },
  };
}

/**
 * Owns the (lazy) backend and the abort of any in-flight generation. A new
 * question aborts the previous one; `release()` aborts and disposes so the
 * platform frees the model. Safe to call `release()` repeatedly.
 */
export class AssistantSession {
  private backend: AssistantBackend | null = null;
  private abort: AbortController | null = null;
  private creating: Promise<AssistantBackend> | null = null;

  constructor(private readonly makeBackend: () => Promise<AssistantBackend>) {}

  async ask(question: string, context: string): Promise<string> {
    this.abort?.abort();
    const controller = new AbortController();
    this.abort = controller;
    if (!this.backend) {
      this.creating ??= this.makeBackend();
      try {
        this.backend = await this.creating;
      } finally {
        this.creating = null;
      }
    }
    return this.backend.ask(question, context, controller.signal);
  }

  /** Abort in-flight work and drop the backend so the model is unloaded (D2). */
  release(): void {
    this.abort?.abort();
    this.abort = null;
    const b = this.backend;
    this.backend = null;
    b?.dispose();
  }
}
