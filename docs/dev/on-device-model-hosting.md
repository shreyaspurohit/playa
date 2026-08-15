# On-device model hosting (R2) — provenance, upload, and upgrade runbook

Operational companion to [ADR 21](../21-on-device-assistant.md). Covers exactly
where the downloadable WebGPU model assets come from, how they were uploaded to
Cloudflare R2, how the integrity pins were generated, and the **step-by-step
upgrade** when bumping the WebLLM version. Follow this whenever the model set or
the `@mlc-ai/web-llm` version changes.

Everything here is infrastructure/provenance. No fetched camp data is involved.

## What is hosted, and why

The downloadable tier (ADR 21 D3.2) runs a quantized ~1B model in the browser
via WebGPU. WebLLM needs two kinds of asset per model:

1. **Weights** — the MLC model folder (`params_shard_*.bin`, `ndarray-cache.json`,
   `mlc-chat-config.json`, `tokenizer*.json`). Large (574–939 MB). Inert data.
2. **wasm library** — the TVM runtime compiled for that model's architecture +
   quantization (`*_cs1k-webgpu.wasm`, ~5–6 MB). This is the one piece that is
   actual **executable code**, so it is the asset we SHA-256-pin (D6).

By default WebLLM fetches weights from HuggingFace and the wasm from
`raw.githubusercontent.com`. We **self-host both on Cloudflare R2** so:

- the assets are stable and independent of upstream availability,
- integrity is anchored in the app (we pin the wasm hash and deploy the pin
  through the trusted CI → Pages path),
- there is no third-party host contacted from the app besides our own origin.

## Where the bucket lives

| Thing | Value |
|---|---|
| R2 bucket | `playa-models` (Cloudflare account `9987640e1ac0389cc5def92855013083`) |
| Public custom domain | `https://models.purohit.dev` (Public Access = Enabled) |
| CORS | `access-control-allow-origin: https://playa.purohit.dev` (already set) |
| rclone remote | `playa-models` (S3 provider = Cloudflare, `region = auto`) |

**rclone path gotcha (this bit us):** rclone syntax is `remote:bucket/path`. The
remote *and* the bucket are both named `playa-models`, so the correct target is
`playa-models:playa-models`, **not** `playa-models:models`. A wrong bucket name
returns `403 AccessDenied` (R2 returns 403, not 404, for a missing bucket under a
scoped token), which looks exactly like a permissions error but isn't. The AWS
CLI form is `s3://playa-models`.

## Bucket layout

```
playa-models/                                  (bucket)
├── Llama-3.2-1B-Instruct-q4f16_1-MLC/         weight folder (WebLLM `model`)
├── gemma3-1b-it-q4f16_1-MLC/
├── Qwen3-1.7B-q4f16_1-MLC/
└── libs/
    └── v0_2_84/                               ← == @mlc-ai/web-llm version
        ├── Llama-3.2-1B-Instruct-q4f16_1_cs1k-webgpu.wasm
        ├── gemma3-1b-it-q4f16_1_cs1k-webgpu.wasm
        └── Qwen3-1.7B-q4f16_1_cs1k-webgpu.wasm
```

The wasm libs are namespaced by WebLLM version (`libs/<version>/`) so a version
bump adds a new folder and never disturbs a deployed app pinned to the old one.

## How the WEIGHTS were obtained + uploaded

1. **Source:** the MLC-converted repos on HuggingFace —
   `huggingface.co/mlc-ai/<model_id>` for each of the three `model_id`s. They
   were pulled locally to `~/code/models/<model_id>/` (git-lfs / hf download).
2. **Clean up HF artifacts** (don't ship them): each folder had a `.cache/`
   from the HF downloader. Purge before/after upload:
   ```bash
   rclone purge playa-models:playa-models/<model_id>/.cache
   ```
3. **Upload** (contents land at the bucket root under the model-id folder):
   ```bash
   rclone copy ~/code/models playa-models:playa-models --progress \
     --transfers 8 --checkers 16 --exclude '**/.cache/**'
   ```

Weights are **not** hash-pinned in the app (inert data; the bucket is
read-only to the world; worst case is poisoned output, mitigated by D4 grounding
+ the D7 disclaimer — see ADR 21 D6). If you ever want to pin them too, hash
`ndarray-cache.json` per model and verify it before load; note WebLLM offers no
per-shard verification hook, so full-set verification needs a custom loader.

## How the WASM LIBS were obtained, hashed, and uploaded

This is the part that must stay exactly in sync with the pinned WebLLM version.

1. **Find the exact upstream wasm URL for each model** from the pinned WebLLM
   package's `prebuiltAppConfig` (never guess the filename — it encodes context
   size and target and changes between versions):
   ```bash
   cd client && npm install --save-exact @mlc-ai/web-llm@<version>
   node --input-type=module -e '
     import { prebuiltAppConfig } from "@mlc-ai/web-llm";
     for (const id of ["Llama-3.2-1B-Instruct-q4f16_1-MLC","gemma3-1b-it-q4f16_1-MLC","Qwen3-1.7B-q4f16_1-MLC"]) {
       const m = prebuiltAppConfig.model_list.find(x => x.model_id === id);
       console.log(id, "\n  lib:", m.model_lib, "\n  vram:", m.vram_required_MB);
     }'
   ```
   For `0.2.84` the libs live under
   `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/<lib>.wasm`.
2. **Download** the three `.wasm` files locally.
3. **Generate the SHA-256 pins** (these are what go into `modelCatalog.ts`):
   ```bash
   shasum -a 256 *.wasm
   ```
   The values recorded for `v0_2_84`:

   | model_id | wasm file | SHA-256 |
   |---|---|---|
   | `Llama-3.2-1B-Instruct-q4f16_1-MLC` | `Llama-3.2-1B-Instruct-q4f16_1_cs1k-webgpu.wasm` | `2aa9b5f0c8de532f6cbf6bb7b863aaa02645bf6fff856083b202f968712d3f92` |
   | `gemma3-1b-it-q4f16_1-MLC` | `gemma3-1b-it-q4f16_1_cs1k-webgpu.wasm` | `c608d6eb62de3b7dd7444d3d48088f073e3b68a719dfe77e111efac70dd2e165` |
   | `Qwen3-1.7B-q4f16_1-MLC` | `Qwen3-1.7B-q4f16_1_cs1k-webgpu.wasm` | `8161aaa4b40bccf19fcedb2f2e8c221eb9efb72d2198681f1958c9c1e05a682f` |

4. **Upload** to the version-pinned prefix:
   ```bash
   rclone copy ./wasmlibs playa-models:playa-models/libs/v0_2_84 --progress
   ```
5. **Verify public reachability + type:**
   ```bash
   curl -s -o /dev/null -w '%{http_code} %{content_type}\n' \
     https://models.purohit.dev/libs/v0_2_84/Llama-3.2-1B-Instruct-q4f16_1_cs1k-webgpu.wasm
   # expect: 200 application/wasm
   ```

At runtime, `client/src/assistant/webllm.ts::verifyModelLib()` fetches the lib
and checks its bytes against the pinned hash (`integrity.ts::matchesSha256`)
**before** the engine instantiates — a mismatch fails closed.

## Upgrading the WebLLM version

Do all of this together in one PR; the npm dep, the hosted libs, and the pins in
`modelCatalog.ts` must always describe the same version.

1. **Bump the dep:** `cd client && npm install --save-exact @mlc-ai/web-llm@<new>`.
2. **Re-extract** the `model_lib` URLs + `vram_required_MB` with the node
   snippet above (filenames and VRAM can change between versions).
3. **Download** the new `.wasm` libs and `shasum -a 256` them.
4. **Upload** to a NEW prefix `libs/<new_version>/` (e.g. `libs/v0_2_90/`). Leave
   the old prefix in place until the new app is deployed everywhere.
5. **Update `client/src/assistant/modelCatalog.ts`:**
   - `WEBLLM_VERSION = 'v0_2_90'` (drives the lib URL path).
   - each model's `libFile` (if the filename changed) and `libSha256` (always).
   - `vramMB` / `downloadMB` if the model or quantization changed.
6. **If the model set changes**, also re-upload weight folders (HF → R2) and
   update `CATALOG` ids/labels + `offerFor()` device gating.
7. **Verify:** `npm run typecheck && make test-js` (catalog tests assert the
   pins are 64-hex and the URLs are single-origin), then `make rebuild`.
8. **Deploy**, confirm a real download works, then optionally delete the old
   `libs/<old_version>/` prefix from R2.

## Cost

R2 free tier: 10 GB-month storage, 1M Class-A + 10M Class-B ops/month, and
**free egress**. The three models total ~2.2 GB (under free storage), and users
downloading them cost no bandwidth. Effectively free at friends scale.
