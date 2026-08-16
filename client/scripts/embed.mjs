// Build-time embedding step (ADR 21 semantic search).
//
// Reads `data/embeddings/records.json` (written by the Python builder: one
// {key, text} per shipped camp/art), embeds each with the SAME MiniLM model the
// browser uses, and writes `data/embeddings/vectors.json` (int8-quantized,
// base64). A content-hash cache (`cache.json`) makes this INCREMENTAL — a record
// whose text is unchanged reuses its cached vector, so a normal rebuild embeds
// only what actually changed.
//
// Uses @huggingface/transformers with native onnxruntime-node (fast at build).
// Run from client/ so node_modules resolves; paths are relative to PLAYA_ROOT.

import { pipeline, env } from '@huggingface/transformers';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ROOT = process.env.PLAYA_ROOT || process.cwd();
const DIR = `${ROOT}/data/embeddings`;
const RECORDS = `${DIR}/records.json`;
const CACHE = `${DIR}/cache.json`;
const OUT = `${DIR}/vectors.json`;

const MODEL_ID = 'all-MiniLM-L6-v2';
const REVISION = 'main';
const DIM = 384;

// Fetch model weights from the same self-hosted R2 the browser uses, so the
// build never depends on HuggingFace and always matches production.
env.allowLocalModels = false;
env.remoteHost = process.env.BM_MODELS_BASE || 'https://models.purohit.dev';
env.remotePathTemplate = '{model}/resolve/{revision}/';

const sha1 = (s) => createHash('sha1').update(s).digest('hex');

function quantize(vec) {
  const q = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    const x = Math.round(vec[i] * 127);
    q[i] = x > 127 ? 127 : x < -128 ? -128 : x;
  }
  return q;
}

if (!existsSync(RECORDS)) {
  console.error(`embed: no records at ${RECORDS} — nothing to do`);
  process.exit(0);
}

const records = JSON.parse(readFileSync(RECORDS, 'utf8')); // [{key, text}]

// The cache is keyed by record-text hash, but is ONLY valid for one model
// config. Any change to the model/revision/dtype/pooling/normalization/dim
// yields a different embedding space, so gate the whole cache by a config
// signature — a mismatch re-embeds everything instead of mixing vector spaces.
const CONFIG_SIG = `${MODEL_ID}@${REVISION} dtype=q8 pooling=mean normalize=true dim=${DIM}`;
let cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
if (cache.__config !== CONFIG_SIG) {
  if (cache.__config) console.log(`embed: model config changed → re-embedding all`);
  cache = { __config: CONFIG_SIG };
}

// dtype 'q8' → onnx/model_quantized.onnx (the file we self-host). Node would
// otherwise default to the full fp32 model.onnx.
const extractor = await pipeline('feature-extraction', MODEL_ID, { revision: REVISION, dtype: 'q8' });

let embedded = 0;
let reused = 0;
const nextCache = { __config: CONFIG_SIG };
const parts = [];
const keys = [];

for (const { key, text } of records) {
  const h = sha1(text || '');
  let b64 = cache[h];
  if (b64) {
    reused++;
  } else {
    const out = await extractor(text || '', { pooling: 'mean', normalize: true });
    const q = quantize(out.data);
    b64 = Buffer.from(q.buffer, q.byteOffset, q.byteLength).toString('base64');
    embedded++;
  }
  nextCache[h] = b64;
  keys.push(key);
  parts.push(Buffer.from(b64, 'base64'));
}

const data = Buffer.concat(parts).toString('base64');
mkdirSync(DIR, { recursive: true });
writeFileSync(CACHE, JSON.stringify(nextCache));
// `sig` must match embedModel.ts::EMBED_SIG — the client rejects a mismatch.
writeFileSync(OUT, JSON.stringify({ model: MODEL_ID, dim: DIM, q: 'int8', sig: CONFIG_SIG, keys, data }));

console.log(`embed: ${embedded} new, ${reused} cached, ${keys.length} total → ${OUT}`);
