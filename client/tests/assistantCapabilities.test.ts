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

  test('no built-in but WebGPU present → retrieval-only, download flagged possible', async () => {
    delete g.LanguageModel;
    setNav({ gpu: {} });
    const c = await detectCapabilities();
    assert.equal(c.tier, 'retrieval-only');
    assert.equal(c.webgpuDownloadPossible, true);
  });

  test('nothing available → retrieval-only, no download hint', async () => {
    delete g.LanguageModel;
    setNav({});
    const c = await detectCapabilities();
    assert.equal(c.tier, 'retrieval-only');
    assert.equal(c.webgpuDownloadPossible, false);
  });
});
