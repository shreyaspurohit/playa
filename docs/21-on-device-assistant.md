---
title: On-device assistant ("Ask")
date: 2026-08-14
status: accepted — phase 1 + phase 2 implemented (downloadable WebGPU model self-hosted on Cloudflare R2, wasm hash-pinned, code-split chunk)
---

# On-device assistant ("Ask")

## Overview

An **opt-in, fully on-device** natural-language "Ask" surface: users type a
question ("where's coffee near me open now?", "what's on tonight at 9?", "chill
lounges near my camp") and get an answer grounded in the data the app already
holds — camps, events (with parsed times), food classification, art, the map,
and *their own* saved favorites / journal / meet-spots.

Two hard commitments shape every decision:

1. **No cloud, ever.** Nothing about a question or the camp data leaves the
   device. This preserves the whole project's privacy/ToS posture (a cloud LLM
   would ship copyrighted camp text to a third party — see
   [13-tos-compliance.md](./13-tos-compliance.md) and
   [15-data-sources.md](./15-data-sources.md)).
2. **Foreground-only, zero background cost.** Inference runs *only* while the
   app is open and visible. No service-worker inference, no background tasks,
   no wake-locks. A model is loaded lazily on first use and released when the
   tab is hidden, so there is never idle battery/GPU drain (D2).

The generative model is never the source of truth. It phrases and routes; the
app's structured data is the authority, and answers cite the real cards the
user can tap. This is what lets a phone-sized (~1B) model be useful without
hallucinating camp facts.

## Decisions

### D1 — Opt-in, off by default, on-device only

The assistant ships **off**. It surfaces as an "Ask" entry the user chooses to
open; nothing loads a model or runs inference until they do. There is no cloud
fallback and no "bring your own API key" mode — a cloud path would break the
no-data-leaves-device promise and re-open the §5/§6 ToS questions we spent the
rest of the app avoiding. If we ever reconsider, it is a new ADR, not a flag.

### D2 — Foreground-only lifecycle (no background drain)

This is a first-class requirement, not an optimization.

- The model backend is created **lazily** on the first question, never at app
  boot.
- Inference only runs in response to a user action in the foreground.
- On `document.visibilitychange` → hidden (tab backgrounded, phone locked, app
  switched), any in-flight generation is **aborted** and the session is
  released so the GPU/CPU and memory are freed.
- The **service worker never runs inference.** It only ever precached the app
  shell (see [07-offline-pwa.md](./07-offline-pwa.md)); the assistant adds
  nothing to it.
- No `navigator.wakeLock`, no timers, no periodic-background-sync. If the app
  is not open and visible, the assistant consumes nothing.

### D3 — Tiered backend, best-effort per platform

Support is a graceful cascade, resolved at question time by capability
detection — never by user-agent sniffing:

1. **Browser built-in model** — if the platform exposes a built-in on-device
   LLM API (Chrome/Chromium `LanguageModel` / Prompt API, Gemini Nano), use it.
   The browser owns the model and its download; the app calls it with no weight
   hosting and **no CSP change**. Covers desktop Chrome/Edge-Chromium and
   Android Chrome. (Chrome 148+, May 2026.)
2. **Downloadable WebGPU model** *(phase 2 — see D6)* — where no built-in model
   exists but WebGPU does (Safari/iOS 26+, Firefox, Chromium without the flag),
   offer an **explicit opt-in download** of a small quantized model
   (WebLLM/MLC or transformers.js), cached for offline reuse. Size is disclosed
   **before** any bytes download.
3. **Retrieval-only fallback** — everywhere else (no built-in model, no WebGPU,
   pre-iOS-26, or the user declines the download): answer **without generation**
   by running the question through the retrieval layer (D4) and returning ranked
   real cards plus deterministic computed facts ("3 coffee camps open now near
   you"). Always available, offline, on any device.

The value ladder is deliberate: even tier 3 (zero model) is useful, so the
feature is never "broken" — it just gets more conversational as the platform
allows.

### D4 — Retrieval grounding is the source of truth

Regardless of tier, a question is first turned into a **retrieval** over the
in-memory data the app already indexes: camp/event/art haystacks, tag filters,
`display_time`/`parsed_time`, food classification + live "open now", map
addresses + Near-Me distances, and the user's own favorites, journal, and meet
spots. When a generative tier is available, the retrieved records are passed as
grounding context and the model is instructed to answer **only** from them and
to reference cards by name; the UI renders those as tappable links to the real
cards. This keeps a tiny model honest and makes every answer verifiable, which
also satisfies the app's standing "always verify on directory.burningman.org"
disclaimer.

### D5 — Platform floor and model sizing

- **iOS/iPadOS 26+** is the floor for the WebGPU tier (WebGPU shipped there in
  Safari/Tahoe 26); older iOS gets retrieval-only. This is detected, not
  assumed.
- On phones, only **~1B** aggressively-quantized models are offered — iOS
  enforces a hard per-tab memory cap and larger models OOM-kill the tab. The
  download UI picks a device-appropriate size; a failed load falls back to
  tier 3 rather than crashing.
- **The download is only offered when the model can actually run.** Presence of
  `navigator.gpu` is necessary but not sufficient: our q4f16 models need the
  WebGPU **`shader-f16`** feature, which some Safari/Firefox/GPU combinations
  lack. `capabilities.ts::webgpuCanRunF16()` acquires an adapter and checks
  `adapter.features.has('shader-f16')` **before** the download button appears, so
  a user is never invited to pull ~600 MB onto a device that would only fall back
  to smart search. If the probe fails, the surface silently stays in the
  retrieval-only tier — no error, no guilt-trip.

### D6 — Weight delivery + integrity *(implemented: self-host on Cloudflare R2, wasm hash-pinned, code-split)*

The app is a single self-contained `index.html` and the build inlines one IIFE
bundle. The built-in-model tier (D3.1) needs neither a network host nor any code
delivery change — the browser has the model. The downloadable tier (D3.2) needs
to (a) fetch weights + wasm from somewhere, and (b) ship ~6 MB of web-llm runtime
without burdening every non-AI user.

**CSP note (corrected):** there is currently **no CSP enforced** on this
deployment — no `http-equiv` meta in the template and no edge/CDN CSP header (as
of 2026-08). So fetching from the model origin needs no CSP change today. CORS on
the R2 custom domain already returns `access-control-allow-origin:
https://playa.purohit.dev`. **If** a CSP is ever introduced (edge header or meta),
it MUST include: `connect-src https://models.purohit.dev`, `script-src
'wasm-unsafe-eval'` (WebGPU/WASM compile), and `worker-src 'self' blob:`.

**Code delivery — second esbuild entry, not full `splitting:true`.** To keep
web-llm out of the inlined main bundle we add a **second esbuild entry point**
(`src/assistant/webllm.ts` → `dist/webllm-backend.js`, ESM) rather than switching
the whole app to `format:'esm' + splitting:true`. The Python builder copies the
chunk next to `index.html`; the main bundle loads it via a dynamic `import()`
with a **runtime-computed specifier** (`webllmLoader.ts`) so esbuild leaves it
external. Result: the core app stays a single inlined IIFE (preserving the
single-file value for everyone), and web-llm's ~6 MB downloads **only** when a
user opts into the model. The chunk is same-origin, so the existing service
worker runtime-caches it on first use (offline afterward); it is deliberately
**not** in the SW precache SHELL, so non-AI users never pay for it.

**Storage: self-host on Cloudflare R2** (chosen over a user-provided-file flow
for the far better UX of a one-tap download). Concretely:

- **Storage.** A Cloudflare **R2** bucket, exposed **public-read** via a custom
  domain (e.g. `models.purohit.dev`). R2 public buckets are **read-only to the
  world by construction** — anonymous writes are impossible; overwriting a file
  requires the owner's Cloudflare credentials. This alone defeats the
  "someone swaps the model in an open bucket" threat unless the *account* is
  compromised (same trust boundary as the whole deployment). Egress is free on
  R2, so a couple-GB file at friends scale costs pennies.
- **Integrity — pin the wasm library (the only executable asset).** For each
  model the app pins a **SHA-256 of the wasm library** in
  `client/src/assistant/modelCatalog.ts`, and `webllm.ts::verifyModelLib()`
  fetches + hashes the bytes and **fails closed** on mismatch before the engine
  instantiates. The wasm is the one asset that is real code, so this is the
  high-value pin. The pin lives in the app, deployed through the trusted CI →
  Pages path, so integrity is anchored to the app, not the bucket. See
  [dev/on-device-model-hosting.md](./dev/on-device-model-hosting.md) for how the
  hashes are generated and kept in sync with the WebLLM version.
- **Weights are data, not code.** The WebGPU/WASM *runtime* ships in the
  code-split chunk (from CI, never from the bucket), so a tampered *weight* file
  cannot execute code — worst case is poisoned output (mitigated by D4 grounding
  + D7 disclaimer), not RCE. Weight shards are therefore **not** individually
  pinned (WebLLM exposes no per-shard verification hook); pinning
  `ndarray-cache.json` per model is a documented future option if desired.

The rejected alternative — **(b) user-provided file** loaded from disk via a
WASM runtime — needs no host but has worse UX and shifts trust to the user's
download source; kept on record only as a fallback if hosting ever becomes
undesirable.

**Chosen models** (WebLLM `prebuiltAppConfig` ids, q4f16_1) — hosted at
`https://models.purohit.dev/<model_id>/`, wasm libs at
`https://models.purohit.dev/libs/v0_2_84/`:

| Tier | model_id | download | WebGPU VRAM |
|---|---|---|---|
| phone default (≥6 GB RAM) | `Llama-3.2-1B-Instruct-q4f16_1-MLC` | 672 MB | 879 MB |
| ultra-light / low-RAM phone | `gemma3-1b-it-q4f16_1-MLC` | 574 MB | 711 MB |
| desktop default | `Qwen3-1.7B-q4f16_1-MLC` | 939 MB | 2037 MB |

Device gating (`modelCatalog.ts::offerFor`): phones are offered only the two 1B
models (the 1.7B needs ~2 GB VRAM and reliably OOMs a mobile tab, D5); the
recommended default scales with `navigator.deviceMemory`. Sizes are the real
measured folder sizes and are disclosed **before** any download; the download is
opt-in and cached (Cache API) for offline reuse. Phase 1 (D3.1 + D3.3) remains
fully functional without any of this.

**Download lifecycle nuance (D2 boundary).** WebLLM's `CreateMLCEngine` exposes
no abort hook for an in-progress download, so a model download the user
explicitly started may finish even if they close the Ask surface; completed
shards are cached, so this is at worst one extra completed download the user
asked for. What D2 strictly guarantees remains intact: **no model loads without
an explicit tap, no inference runs in the background, and the loaded model is
unloaded (`engine.unload()`) when the tab is hidden or the surface closes.**

### D7 — Honest framing and privacy disclosure

The Ask surface states plainly: answers are generated on-device by a small
model, may be wrong, and should be verified on the real cards / the directory.
The About modal's existing "what to trust less" list gains the assistant.
Because nothing leaves the device, the app's no-cloud/no-tracking claims remain
accurate; the built-in-model tier's model download (if any) is performed by the
browser itself, not by the app, and is disclosed as such.

### D8 — Phasing

- **Phase 1 (implemented):** capability detection, the retrieval/grounding
  engine, the foreground-only session lifecycle, the Ask UI, the built-in-model
  tier (D3.1), and the retrieval-only tier (D3.3). No new runtime dependency in
  the main bundle, works offline, ships in the single file.
- **Phase 2 (implemented):** the downloadable WebGPU model tier — `@mlc-ai/web-llm`
  pinned at `0.2.84`, code-split into `webllm-backend.js` (loaded only on opt-in),
  the self-hosted R2 weights + wasm libs, the wasm SHA-256 integrity pins, and the
  opt-in download UI (size disclosed up front, progress, offline caching, OOM
  fallback). Operational runbook:
  [dev/on-device-model-hosting.md](./dev/on-device-model-hosting.md).

## Failure modes & trade-offs

- **Hallucination.** Mitigated by D4 grounding, the D7 disclaimer, and citing
  real cards; not eliminated. The model is framed as a convenience, never
  authority.
- **iOS memory OOM.** Model load is wrapped; a failure falls back to tier 3
  and surfaces a plain "your device couldn't run the model" note. Never a
  hard crash of the app.
- **No capable platform.** Tier 3 always answers, so the feature degrades to
  "smart search", never to nothing.
- **Offline.** Once a model is present (built-in or downloaded+cached), the
  whole feature works offline — which is the point on playa. Tier 3 is offline
  unconditionally.
- **Model download abandoned/expensive.** Phase-2 concern: size disclosed up
  front, resumable/cached, and never auto-started.
- **Scope creep toward a chatbot.** Deliberately resisted — this answers
  questions about *this* data, not open-ended conversation.

## Code references

Phase 1 (built-in / retrieval tiers):

- `client/src/assistant/capabilities.ts` — detect the built-in `LanguageModel`
  API + WebGPU + device hint; classify the available tier.
- `client/src/assistant/retrieval.ts` — pure question → grounded context over
  camps/events/art/food/favorites/journal/map. No model, fully testable.
- `client/src/assistant/session.ts` — foreground-only backend session: lazy
  create, `prewarm()`, abort/release on `visibilitychange` hidden (D2).
- `client/src/hooks/useAssistant.ts` — wires capability + retrieval + session +
  the download tier into UI state.
- `client/src/components/AskView.tsx` — the opt-in Ask surface + download panel.

Phase 2 (downloadable WebGPU model):

- `client/src/assistant/modelCatalog.ts` — pinned version, R2 origin, per-model
  size/VRAM/wasm-SHA-256, and `offerFor()` device gating. Pure + tested.
- `client/src/assistant/integrity.ts` — `sha256Hex` / `matchesSha256` (D6). Pure.
- `client/src/assistant/webllm.ts` — the web-llm backend behind the same
  `AssistantBackend` interface; `verifyModelLib()` then `CreateMLCEngine`. **This
  file is the code-split boundary** (statically imports `@mlc-ai/web-llm`).
- `client/src/assistant/webllmLoader.ts` — in the MAIN bundle; dynamic-`import()`s
  the chunk via a runtime specifier so esbuild keeps it external.
- `client/esbuild.config.mjs` — second entry point → `dist/webllm-backend.js`.
- `backend/src/playa/builder.py::_copy_webllm_backend` — copies the chunk into
  `site/` (not inlined, not in the SW precache SHELL).
- Hosting/upgrade runbook: [dev/on-device-model-hosting.md](./dev/on-device-model-hosting.md).
