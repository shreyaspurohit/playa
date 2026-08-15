import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCapabilities } from '../src/assistant/capabilities';

const g = globalThis as unknown as { LanguageModel?: unknown; navigator?: unknown };
const originalLM = g.LanguageModel;
const originalNav = g.navigator;

// `navigator` is a getter-only global in Node, so it must be replaced via
// defineProperty rather than assignment.
function setNav(value: unknown) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true });
}

afterEach(() => {
  if (originalLM === undefined) delete g.LanguageModel; else g.LanguageModel = originalLM;
  setNav(originalNav);
});

describe('assistant capabilities (ADR 21 D3)', () => {
  test('built-in model available → builtin tier', async () => {
    g.LanguageModel = { create: async () => ({}), availability: async () => 'available' };
    const c = await detectCapabilities();
    assert.equal(c.tier, 'builtin');
    assert.equal(c.builtinModel, true);
  });

  test('availability "unavailable" → not builtin', async () => {
    g.LanguageModel = { create: async () => ({}), availability: async () => 'unavailable' };
    const c = await detectCapabilities();
    assert.equal(c.builtinModel, false);
    assert.equal(c.tier, 'retrieval-only');
  });

  test('WebGPU adapter WITH shader-f16 → download flagged possible', async () => {
    delete g.LanguageModel;
    setNav({ gpu: { requestAdapter: async () => ({ features: new Set(['shader-f16']) }) } });
    const c = await detectCapabilities();
    assert.equal(c.tier, 'retrieval-only');
    assert.equal(c.webgpuDownloadPossible, true);
  });

  test('WebGPU present but adapter LACKS shader-f16 → not offered (avoids doomed download)', async () => {
    delete g.LanguageModel;
    setNav({ gpu: { requestAdapter: async () => ({ features: new Set(['depth-clip-control']) }) } });
    const c = await detectCapabilities();
    assert.equal(c.webgpuDownloadPossible, false);
  });

  test('WebGPU present but no adapter obtainable → not offered', async () => {
    delete g.LanguageModel;
    setNav({ gpu: { requestAdapter: async () => null } });
    const c = await detectCapabilities();
    assert.equal(c.webgpuDownloadPossible, false);
  });

  test('requestAdapter throws → not offered (fails safe)', async () => {
    delete g.LanguageModel;
    setNav({ gpu: { requestAdapter: async () => { throw new Error('no gpu'); } } });
    const c = await detectCapabilities();
    assert.equal(c.webgpuDownloadPossible, false);
  });

  test('nothing available → retrieval-only, no download hint', async () => {
    delete g.LanguageModel;
    setNav({});
    const c = await detectCapabilities();
    assert.equal(c.tier, 'retrieval-only');
    assert.equal(c.webgpuDownloadPossible, false);
  });
});
