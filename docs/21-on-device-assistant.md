---
title: On-device assistant ("Ask")
date: 2026-08-14
status: accepted — phase 1 implemented; phase 2 (downloadable model) designed, gated on an owner CSP/hosting decision
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

### D6 — CSP + weight delivery *(open owner decision — gates phase 2)*

The app is a single self-contained `index.html` with a strict CSP that blocks
external hosts, and the build inlines one IIFE bundle. The built-in-model tier
(D3.1) needs neither a network host nor a CSP change — the browser has the
model — so **phase 1 ships without touching the CSP**. The downloadable tier
(D3.2) cannot fetch weights under today's CSP. Two viable shapes, to be chosen
by the owner before phase 2:

- **(a) Self-host weights** on the existing Cloudflare/Pages origin and add a
  narrow `connect-src` (and the WebGPU/WASM `script-src`/`worker-src`)
  exception for exactly that origin. Cleanest UX (a "Download (~N MB)" button),
  at the cost of hosting large binaries and a deliberate CSP relaxation.
- **(b) User-provided file** — the user downloads a `.gguf`/model bundle per our
  instructions and loads it via a file picker; a WASM runtime (e.g. wllama)
  reads it from disk. **No network, no CSP change**, most faithful to "the user
  downloads it themselves" — slower (CPU/WASM) and clunkier UX.

Until this is decided, phase 2 is not built. Phase 1 (D3.1 + D3.3) is fully
functional on its own.

### D7 — Honest framing and privacy disclosure

The Ask surface states plainly: answers are generated on-device by a small
model, may be wrong, and should be verified on the real cards / the directory.
The About modal's existing "what to trust less" list gains the assistant.
Because nothing leaves the device, the app's no-cloud/no-tracking claims remain
accurate; the built-in-model tier's model download (if any) is performed by the
browser itself, not by the app, and is disclosed as such.

### D8 — Phasing

- **Phase 1 (this ADR, implemented):** capability detection, the retrieval/
  grounding engine, the foreground-only session lifecycle, the Ask UI, the
  built-in-model tier (D3.1), and the retrieval-only tier (D3.3). No CSP change,
  no new runtime dependency, works offline, ships in the single file.
- **Phase 2 (designed, gated on D6):** the downloadable WebGPU model tier, its
  opt-in download/size/instructions banner, and the model cache lifecycle.

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

Phase 1 entry points:

- `client/src/assistant/capabilities.ts` — detect the built-in `LanguageModel`
  API and WebGPU; classify the available tier.
- `client/src/assistant/retrieval.ts` — pure question → grounded context over
  camps/events/art/food/favorites/journal/map. No model, fully testable.
- `client/src/assistant/session.ts` — foreground-only backend session: lazy
  create, abort/release on `visibilitychange` hidden (D2).
- `client/src/hooks/useAssistant.ts` — wires capability + retrieval + session
  into UI state.
- `client/src/components/AskView.tsx` — the opt-in Ask surface.

Phase 2 (not yet built): a `client/src/assistant/webllm.ts` backend behind the
same session interface, plus the D6 CSP/hosting change.
