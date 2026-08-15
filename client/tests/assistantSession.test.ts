import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AssistantSession, type AssistantBackend } from '../src/assistant/session';

function fakeBackend(log: string[]): AssistantBackend {
  return {
    async ask(question, _context, signal) {
      log.push(`ask:${question}`);
      // Reject if aborted mid-flight, like a real backend.
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      return `answer:${question}`;
    },
    dispose() { log.push('dispose'); },
  };
}

describe('AssistantSession (ADR 21 D2)', () => {
  test('creates the backend lazily — not before the first ask', async () => {
    const log: string[] = [];
    let made = 0;
    const s = new AssistantSession(async () => { made += 1; return fakeBackend(log); });
    assert.equal(made, 0);                       // nothing created at construction
    await s.ask('hi', 'ctx');
    assert.equal(made, 1);
    await s.ask('again', 'ctx');
    assert.equal(made, 1);                       // reused, not recreated
    assert.deepEqual(log, ['ask:hi', 'ask:again']);
  });

  test('release() disposes the backend and unloads it (foreground-only)', async () => {
    const log: string[] = [];
    const s = new AssistantSession(async () => fakeBackend(log));
    await s.ask('q', 'ctx');
    s.release();
    assert.ok(log.includes('dispose'));
    // A subsequent ask rebuilds a fresh backend.
    await s.ask('q2', 'ctx');
    assert.equal(log.filter((l) => l === 'dispose').length, 1);
    assert.ok(log.includes('ask:q2'));
  });

  test('release() before any ask is a safe no-op', () => {
    const s = new AssistantSession(async () => fakeBackend([]));
    assert.doesNotThrow(() => s.release());
  });
});
