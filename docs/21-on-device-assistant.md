---
title: On-device "Ask" (semantic search)
date: 2026-08-14 (rewritten 2026-08-16 after the generative approach was dropped)
status: accepted — shipped as opt-in on-device semantic search. A generative LLM was built end-to-end, evaluated, and rejected (see "Why not an LLM"); revisit 2027.
---

# On-device "Ask" (semantic search)

## Overview

**Ask** ("Ask Not AI" 🍄 in the UI) is an **opt-in, fully on-device** search. The
user types a plain-English question — *"where can I relax"*, *"late-night
music"*, *"somewhere warm to get a drink"* — and gets the camps, events, and art
that fit, **ranked by meaning** rather than exact keywords, with optional
**On now** and **Near me** filters. It is gated behind a one-time ~50 MB model
download; after that it works offline. Nothing about the question or the data
leaves the device.

Under the hood it is **semantic search, not a chatbot**:

- a small **MiniLM embedding model** (`all-MiniLM-L6-v2`, ~23 MB q8) runs via
  **`@huggingface/transformers`** on **CPU/WASM** (so it runs on every browser,
  including iPhone — no WebGPU),
- the app embeds the typed query and ranks it against **vectors precomputed at
  build time** for every camp/event/art, using an **`@orama/orama`** vector
  index.

Because it only ever ranks **real records**, it **cannot hallucinate** — the
worst case is an imperfect ranking, never an invented camp.

Two commitments shape it:

1. **No cloud, ever.** Nothing leaves the device. A cloud model would ship
   copyrighted camp text to a third party and re-open the §5/§6 ToS questions the
   rest of the app avoids ([13-tos-compliance.md](./13-tos-compliance.md),
   [15-data-sources.md](./15-data-sources.md)).
2. **Opt-in, zero idle cost.** Nothing loads until the user opens Ask and
   accepts the download; embedding runs only on a typed query. No background
   task, no wake-lock. The regular on-screen search is untouched and always
   available.

## Why not an LLM

The first build of this feature *was* a generative assistant — a tiny LLM that
phrased answers grounded in retrieved records. We built it end-to-end across two
tiers and then **removed all of it**. Recording why, because it is the crux of
this ADR and worth re-checking as the ecosystem moves.

**What we tried**

- **Tier 1 — the browser's built-in model** (Chrome's `LanguageModel` / Gemini
  Nano). Zero hosting, worked on desktop Chrome.
- **Tier 2 — a downloadable WebGPU model** (WebLLM / MLC: Llama-3.2-1B,
  gemma3-1b, Qwen3-1.7B, q4f16), self-hosted on Cloudflare R2, code-split,
  wasm-hash-pinned — the full machinery.
- **Tier 3 — a keyword/retrieval fallback** for everything else.

**Why it lost**

1. **The output was unreliable, even with perfect grounding.** Handed a correct
   list of records and told to "answer only from this," Gemini Nano still replied
   *"I could not find it in the data."* A ~1B model does not reliably follow
   strict grounding or extract a clean list; its prose was routinely **worse than
   the grounded results underneath it**.
2. **The reachable audience was almost nobody.** The WebGPU download tier needs
   `maxStorageBuffersPerShaderStage ≥ 10`, which WebLLM hardcodes. Only **Chromium
   desktop** exposes 10 — **Firefox, Safari, and every iPhone/iPad cap at 8** (all
   iOS browsers are WebKit). So a 600–900 MB download reached, in practice, only
   desktop-Chrome users — a sliver of a Burner audience that is overwhelmingly on
   iPhones.
3. **The hard queries were the wrong job for it.** Precise questions like "camps
   open at 8am on Aug 31" are exactly what a tiny LLM is worst at, and are already
   answered deterministically by the Schedule/Food views. The model added nothing
   there.
4. **The useful part was always the retrieval, not the generation.** Every honest
   answer's value came from the grounded records. Once we accepted that, the
   generative layer was pure cost (size, fragility, narrow reach) for negative
   value.

**What semantic search gives instead:** the "understands what I mean" benefit
(the reason to want AI here) **reliably**, on **every** browser, at **~25 MB**
instead of ~900 MB, with **zero hallucination**. So the whole generative stack —
`@mlc-ai/web-llm`, the R2 LLM weights, the capability/WebGPU tiering, the Chrome
built-in path, the keyword fallback — was deleted and replaced with the design
above.

## Decisions

### D1 — Opt-in, download-gated, one path

Ask ships **off**. Opening it shows a size-disclosed **download prompt** and
nothing else; on accept it downloads the model + runtime + vectors, then works
offline. There is **no fallback tier** inside Ask — either the model is
downloaded (search works) or it is not (the prompt). The app's regular on-screen
search covers everyone who does not opt in, so Ask does not need its own
degraded mode. A cloud path stays out of scope (a new ADR, not a flag).

### D2 — Semantic search, not generation

Ranking is by **embedding similarity over real records**, so results are always
genuine cards. No text is generated; there is nothing to hallucinate and no
"answer" to be wrong. This is what makes the feature trustworthy enough to ship
without a per-answer "this may be wrong" hedge (the standing "verify on the
directory" guidance in the About modal still applies).

### D3 — Stack: transformers.js (CPU/WASM) + MiniLM + Orama

- **Embeddings:** `@huggingface/transformers` running `all-MiniLM-L6-v2` (q8,
  384-dim). **CPU/WASM only** (`env.backends.onnx.wasm`, `numThreads = 1`) so it
  needs no WebGPU and runs on **every** browser including iOS — the exact
  constraint that killed the LLM tier. Embedding one short query is sub-100 ms.
- **Vector search:** `@orama/orama` (`mode: 'vector'`), so we do not hand-roll
  cosine/index code.
- Both are pinned runtime deps, **code-split** into `semantic-backend.js` (see
  D5) so they never touch the main bundle.

### D4 — Self-host the model + runtime on Cloudflare R2

Same hosting rationale as before: an R2 bucket exposed public-read via
`models.purohit.dev` (read-only to the world; free egress; CORS set for the
site + `localhost` for dev). Hosted assets: the MiniLM model files under
`all-MiniLM-L6-v2/resolve/main/…` (HuggingFace layout, which transformers.js
expects) and the ONNX Runtime **wasm variants** under `ort/<version>/` (host all
four — the browser picks one; hosting only some 404s mid-load). Total one-time
download ≈ **50 MB** (model + tokenizer + ORT wasm + the vectors file), disclosed
before the user accepts, cached for offline reuse. Runbook + upgrade steps:
[dev/on-device-model-hosting.md](./dev/on-device-model-hosting.md).

### D5 — Vectors: build-time, incremental, shipped as a separate file

- **Build-time embedding.** `client/scripts/embed.mjs` embeds every shipped
  camp/event/art with the **same** MiniLM model (native `onnxruntime-node`, fast)
  and writes int8-quantized vectors. It is **incremental**: a content-hash cache
  (`data/embeddings/cache.json`) re-embeds only records whose text changed, so a
  rebuild embeds ~nothing. The cache is gated by a config signature — any change
  to the model/revision/dtype/pooling/dim re-embeds everything. In CI the cache
  is persisted across nightly runs via `actions/cache` (only `cache.json`, which
  holds int8 vectors keyed by *text hash* — never `records.json`, which has
  source text). Embedding is gated behind `BM_EMBEDDINGS=1` (set by the `make`
  build targets and the CI build job, off for the test suite). See
  `builder.py::_write_embeddings`.
- **Build/runtime compatibility check.** The payload carries a `sig`
  (model@revision + dtype/pooling/normalize/dim) that must equal
  `embedModel.ts::EMBED_SIG`; the client **rejects a mismatch** rather than
  ranking against a stale embedding space after a partial upgrade.
- **Separate file, not inlined.** The ~4–5 MB of vectors ship as
  **`site/embeddings.json`**, fetched **only when the user opts into the
  download** — so `index.html` stays ~2 MB for every visitor who never opens Ask.
  A cheap `<meta name="bm-embeddings">` tells the client the index exists without
  fetching it.
- **Code-split chunk.** transformers.js + orama build to `semantic-backend.js`
  via a second esbuild entry, copied to `site/` by
  `builder.py::_copy_semantic_backend`, loaded at runtime through a
  runtime-specifier dynamic `import()` (`semanticLoader.ts`) so it stays out of
  the main bundle and is not in the SW precache SHELL.
- **Offline across deploys.** Once fetched, `semantic-backend.js` and
  `embeddings.json` live in the durable `playa-ask-v1` runtime cache rather than
  the nightly versioned shell cache. Transformers.js's `transformers-cache`
  holds the model/runtime and is likewise preserved. Activation prunes only old
  `playa-v…` shell caches; **Clear all local data** explicitly removes both Ask
  caches.

### D6 — Filters: On now / Near me (reuse existing infra)

Two toggles refine results, reusing what the app already has:

- **On now** — keeps events whose `eventAvailability(e, now())` is `now`/`soon`
  (the same logic Food/Schedule use). Events also carry an **on now** /
  **starting soon** badge in any search.
- **Near me** — opt-in GPS (`useGeolocation`), then sorts results by
  `haversineMeters` from the user to each record's BRC address
  (`addressToLatLng`), showing distance. Records without a placeable address drop
  out while it is on.

### D7 — Honest framing & privacy

The surface states plainly that Ask runs entirely on the device and results are
this app's data. Because nothing leaves the device, the app's no-cloud /
no-tracking claims stay accurate. The About modal's "what to trust less" +
"verify on the directory" guidance covers Ask alongside tags and event times.

### D8 — Revisit in 2027

The generative approach was rejected against **2026** realities. Re-evaluate at
2027 prep, because several of the blockers are moving:

- **Small models are improving** — a 2–3B on-device model with reliable
  instruction-following could add real value *on top of* the semantic results (a
  one-line summary, a natural-language filter), where 2026's 1B models added
  negative value.
- **WebGPU limits may equalize** — if Firefox/WebKit raise
  `maxStorageBuffersPerShaderStage` to 10 (and iOS WebGPU matures), the download
  tier's reach stops being desktop-Chrome-only.
- **Browser built-in models** (Chrome's Prompt API, an eventual Safari/WebKit
  equivalent) may become capable and widespread enough to use with no hosting.

**Keep semantic search as the reliable core regardless.** Any future generative
layer is an *optional enhancement on top of* it, never a replacement — the
retrieval is what makes answers trustworthy. If we add one, it is an amendment to
this ADR with a fresh capability check, not a silent swap.

## Failure modes & trade-offs

- **Imperfect ranking**, not hallucination — the worst case is a less-relevant
  card, and the real card is always what's shown.
- **~50 MB download** — disclosed up front, opt-in, cached for offline reuse; the
  regular search serves anyone who declines.
- **The unencrypted vectors file was evaluated and deemed non-sensitive** (so it
  ships as plaintext). `site/embeddings.json` covers every source and is publicly
  fetchable, but it contains only **opaque record keys + non-invertible int8
  vectors** — no names, descriptions, or locations. The keys are useless to an
  outsider: directory IDs are already the public `/camps/<id>/` URLs, and API
  uids fetch nothing without `BM_API_KEY`. Vectors are not practically
  reversible to text, and nothing from a source the user hasn't unlocked is ever
  indexed (`allow(key)` gates on the decrypted `recordMap`) or displayed. So it
  exposes nothing an outsider couldn't already obtain — not private data. (If the
  bar ever tightens, the fix is to gate the vectors per-source like `camps-data`;
  recorded so this isn't re-flagged.)
- **No index in a build** — if `BM_EMBEDDINGS` was off, the meta tag is empty and
  Ask shows an "unavailable" note instead of a broken download.
- **Scope creep toward a chatbot** — deliberately resisted; this searches *this*
  data, it does not converse.

## Code references

- `client/src/assistant/embedModel.ts` — pinned model id/revision, R2 origin,
  ORT version, download size. Pure.
- `client/src/assistant/semantic.ts` — the code-split backend: configures
  transformers.js for R2/CPU, loads the embedder, decodes the shipped vectors,
  builds + queries the Orama index. **Statically imports the heavy libs** (the
  code-split boundary).
- `client/src/assistant/semanticLoader.ts` — MAIN-bundle runtime-specifier
  `import()` of `semantic-backend.js`, keeping the libs external.
- `client/src/assistant/embeddings.ts` — `hasEmbeddings()` (meta check) +
  `fetchEmbeddings()` (the separate vectors file).
- `client/src/hooks/useAssistant.ts` — download-gate state, query → embed →
  Orama search → mapped camp/event/art results, plus the On-now / Near-me filters
  and timing badges.
- `client/src/components/AskView.tsx` — the opt-in Ask surface (download panel,
  filters, results).
- `client/scripts/embed.mjs` — build-time incremental embedder.
- `backend/src/playa/builder.py` — `_write_embeddings` (records → node embed →
  `site/embeddings.json`, `BM_EMBEDDINGS`-gated) and `_copy_semantic_backend`.
- `client/esbuild.config.mjs` — second entry point → `dist/semantic-backend.js`.
- Hosting / upgrade runbook:
  [dev/on-device-model-hosting.md](./dev/on-device-model-hosting.md).
