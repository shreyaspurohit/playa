# On-device model hosting (R2) — provenance, upload, and upgrade runbook

Operational companion to [ADR 21](../21-on-device-assistant.md). Covers where the
**semantic-search** model assets come from, how they are hosted on Cloudflare R2,
and the step-by-step upgrade when the model or `@huggingface/transformers`
version changes.

> **History:** an earlier version of this runbook covered a downloadable **LLM**
> (WebLLM / MLC, 3× ~1B models + wasm libs). That approach was dropped — see ADR
> 21 "Why not an LLM". Those old objects (`*-MLC/` folders and `libs/`) are unused
> and can be deleted from the bucket (see "Cleanup" at the end).

Everything here is infrastructure/provenance. No fetched camp data is involved.

## What is hosted, and why

Ask runs a small embedding model in the browser via `@huggingface/transformers`
on **CPU/WASM**. Two kinds of asset are self-hosted so the app contacts only our
own origin (no HuggingFace, no CDN):

1. **The embedding model** — `all-MiniLM-L6-v2` in HuggingFace layout: `config.json`,
   `tokenizer.json`, `tokenizer_config.json`, `special_tokens_map.json`,
   `vocab.txt`, and `onnx/model_quantized.onnx` (~23 MB, q8). Inert data.
2. **The ONNX Runtime wasm** — the CPU wasm binaries + `.mjs` loaders that
   `onnxruntime-web` (bundled by transformers.js) fetches at runtime.

The model weights are **not** hash-pinned (inert data; the bucket is read-only to
the world — the primary tamper defense). SHA-256s are recorded below for
provenance only.

## Where the bucket lives

| Thing | Value |
|---|---|
| R2 bucket | `playa-models` (Cloudflare account `9987640e1ac0389cc5def92855013083`) |
| Public custom domain | `https://models.purohit.dev` (Public Access = Enabled) |
| CORS | allows `https://playa.purohit.dev` **and** `http://localhost:8080` (add your dev origin to test a local build — a `localhost` fetch is otherwise blocked). |
| rclone remote | `playa-models` (S3 provider = Cloudflare, `region = auto`) |

**rclone path gotcha (this bit us):** rclone syntax is `remote:bucket/path`. The
remote *and* the bucket are both named `playa-models`, so the correct target is
`playa-models:playa-models`, **not** `playa-models:models`. A wrong bucket name
returns `403 AccessDenied` (R2 returns 403, not 404, for a missing bucket under a
scoped token), which looks like a permissions error but isn't. AWS CLI form:
`s3://playa-models`.

## Bucket layout

```
playa-models/                                       (bucket)
├── all-MiniLM-L6-v2/
│   └── resolve/main/                               ← HF layout transformers.js expects
│       ├── config.json  tokenizer.json  tokenizer_config.json
│       ├── special_tokens_map.json  vocab.txt
│       └── onnx/model_quantized.onnx
└── ort/
    └── <onnxruntime-web version>/                  ← e.g. 1.26.0-dev.20260416-b7804b056c
        ├── ort-wasm-simd-threaded.wasm            (+ .mjs)
        ├── ort-wasm-simd-threaded.jsep.wasm       (+ .mjs)
        ├── ort-wasm-simd-threaded.asyncify.wasm   (+ .mjs)
        └── ort-wasm-simd-threaded.jspi.wasm       (+ .mjs)
```

> **Host ALL four ORT wasm variants.** transformers.js/ORT picks a variant per
> environment at load time (we saw Chrome pick `asyncify`). Hosting only some 404s
> mid-load ("Failed to fetch dynamically imported module …asyncify.mjs"). The
> browser downloads only the one it uses.

Both `all-MiniLM-L6-v2` and `ort/<version>` are pinned in
`client/src/assistant/embedModel.ts` (`EMBED_MODEL_ID`, `ORT_VERSION`). CORS on
R2 serves `.mjs` as `text/javascript` and `.wasm` as `application/wasm`
automatically (from the extension) — required for the dynamic module `import()`.

## Provenance + SHA-256

| Asset | Source | SHA-256 |
|---|---|---|
| `onnx/model_quantized.onnx` | `huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx` | `afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1` |
| `ort-wasm-simd-threaded.wasm` | `client/node_modules/onnxruntime-web/dist/` | `f4f290847a4df02d0b93cdbf39b4b0e71acefbe80573e7e6b9342a7abd7b290a` |

## How they were uploaded

```bash
# 1. Model — download the HF files (config/tokenizer + quantized onnx) into
#    all-MiniLM-L6-v2/resolve/main/ (+ onnx/) locally, then:
rclone copy ./minilm playa-models:playa-models --progress   # minilm/ mirrors the resolve/main layout

# 2. ORT runtime — copy every wasm+mjs variant from the installed package:
ORTVER=$(node -e "console.log(require('./node_modules/onnxruntime-web/package.json').version)")   # run from client/, or read the file directly
mkdir -p ort/$ORTVER && cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded*.{wasm,mjs} ort/$ORTVER/
rclone copy ./ort playa-models:playa-models/ort --progress

# 3. Verify (expect 200s + correct content types)
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' \
  https://models.purohit.dev/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx   # 200 application/octet-stream
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' \
  https://models.purohit.dev/ort/$ORTVER/ort-wasm-simd-threaded.asyncify.mjs           # 200 text/javascript
```

## Build-time vectors (not hosted on R2)

The per-record vectors are generated at **build** time, not hosted:
`client/scripts/embed.mjs` embeds every camp/event/art with the same MiniLM model
(native `onnxruntime-node`), incrementally via a content-hash cache
(`data/embeddings/cache.json` → only changed records re-embed), and writes
`site/embeddings.json`, which ships with the Pages artifact. Driven by
`builder.py::_write_embeddings`, gated on `BM_EMBEDDINGS=1` (set by the `make`
build targets). See ADR 21 D5.

## Upgrading the model / transformers.js version

Do these together so the hosted assets and the pinned config agree.

1. **Bump the dep:** `cd client && npm install --save-exact @huggingface/transformers@<new>`.
2. **Re-derive the ORT version** it pulls: read
   `node_modules/onnxruntime-web/package.json` → `version`. If it changed, upload
   the new wasm variant set to `ort/<new-version>/` (step 2 above) and update
   `ORT_VERSION` in `embedModel.ts`.
3. **If the model changes** (e.g. to `bge-small-en-v1.5` for better quality):
   upload its HF files under `<new-model-id>/resolve/main/`, update
   `EMBED_MODEL_ID`/`EMBED_DIM`/`DOWNLOAD_MB` in `embedModel.ts` and the `MODEL_ID`
   in `embed.mjs`, and **delete `data/embeddings/cache.json`** (vectors from a
   different model are incompatible) so everything re-embeds once.
4. **Verify:** `npm run typecheck && make test-js`, then `make rebuild` (embeds +
   ships), and do a real browser download to confirm the model + an ORT variant
   both resolve.

## Cost

R2 free tier: 10 GB-month storage, 1M Class-A + 10M Class-B ops/month, **free
egress**. The model + ORT wasm total well under 100 MB; users downloading them
cost no bandwidth. Effectively free.

## Cleanup — old LLM objects

The abandoned WebLLM approach left these unused objects in the bucket; safe to
delete:

```bash
for m in Llama-3.2-1B-Instruct-q4f16_1-MLC gemma3-1b-it-q4f16_1-MLC Qwen3-1.7B-q4f16_1-MLC; do
  rclone purge "playa-models:playa-models/$m"
done
rclone purge playa-models:playa-models/libs   # the WebLLM wasm libs
```
