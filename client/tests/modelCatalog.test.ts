import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG, WEBLLM_VERSION, MODELS_BASE,
  modelById, modelUrl, modelLibUrl, offerFor,
} from '../src/assistant/modelCatalog';

describe('model catalog (ADR 21 D5/D6)', () => {
  test('every model has a pinned 64-hex wasm hash and positive sizes', () => {
    for (const m of CATALOG) {
      assert.match(m.libSha256, /^[0-9a-f]{64}$/, `${m.id} sha256 is 64 lowercase hex`);
      assert.ok(m.downloadMB > 0 && m.vramMB > 0, `${m.id} has sizes`);
      assert.ok(m.libFile.endsWith('.wasm'), `${m.id} lib is a wasm file`);
    }
  });

  test('urls point only at the self-hosted origin and version-pinned lib path', () => {
    const m = modelById('Llama-3.2-1B-Instruct-q4f16_1-MLC');
    assert.ok(m);
    assert.equal(modelUrl(m!), `${MODELS_BASE}/${m!.id}`);
    assert.equal(modelLibUrl(m!), `${MODELS_BASE}/libs/${WEBLLM_VERSION}/${m!.libFile}`);
    assert.ok(modelUrl(m!).startsWith('https://models.purohit.dev/'));
    assert.ok(modelLibUrl(m!).startsWith('https://models.purohit.dev/libs/'));
  });

  test('phones are offered only 1B models (never the 1.7B, which OOMs)', () => {
    const offer = offerFor({ mobile: true, deviceMemoryGB: 4 });
    assert.ok(!offer.options.some((m) => m.id.includes('Qwen3-1.7B')));
    assert.ok(offer.options.every((m) => m.vramMB < 1500));
    // Low memory → the lighter Gemma is the default.
    assert.equal(offer.recommended.id, 'gemma3-1b-it-q4f16_1-MLC');
  });

  test('a higher-memory phone defaults to the stronger 1B model', () => {
    const offer = offerFor({ mobile: true, deviceMemoryGB: 8 });
    assert.equal(offer.recommended.id, 'Llama-3.2-1B-Instruct-q4f16_1-MLC');
  });

  test('desktop with ample memory is offered and defaults to the 1.7B', () => {
    const offer = offerFor({ mobile: false, deviceMemoryGB: 16 });
    assert.equal(offer.recommended.id, 'Qwen3-1.7B-q4f16_1-MLC');
    assert.equal(offer.options.length, 3);
  });

  test('desktop with unknown memory still gets the 1.7B default (assumed capable)', () => {
    const offer = offerFor({ mobile: false });
    assert.equal(offer.recommended.id, 'Qwen3-1.7B-q4f16_1-MLC');
  });
});
