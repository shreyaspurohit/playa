// Watermark-comparison logic for the release-notes hook. The hook
// reads an embedded <script id="bm-release-notes"> JSON, compares
// each note's ts to LS.releaseNotesSeen, and returns the unseen ones.
//
// Test rules:
//   - First-ever visit anchors the watermark, returns no pending
//     (no "backlog spam" on first install).
//   - With watermark already set, only notes ts > seen come through.
//   - dismiss() advances the watermark to the newest pending ts.
//   - Empty / malformed embedded list → no error, no pending.
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { h, render } from 'preact';
import { installDom, teardownDom } from './_dom';
import {
  useReleaseNotes, type ReleaseNote,
} from '../src/hooks/useReleaseNotes';
import { LS } from '../src/types';
import { readString } from '../src/utils/storage';

let api: ReturnType<typeof useReleaseNotes> | null = null;
let mountpoint: HTMLElement;

function Harness(): null {
  api = useReleaseNotes();
  return null;
}

function embed(notes: ReleaseNote[] | string): void {
  const tag = document.createElement('script');
  tag.id = 'bm-release-notes';
  tag.type = 'application/json';
  tag.textContent = typeof notes === 'string'
    ? notes
    : JSON.stringify(notes);
  document.head.appendChild(tag);
}

beforeEach(() => {
  installDom();
  // Explicit reset — happy-dom's localStorage can persist across
  // Window instances for the same origin, so a test that wrote a
  // watermark would leak into the next test's "first-ever visit"
  // expectation.
  try { localStorage.clear(); } catch { /* ignore */ }
  mountpoint = document.createElement('div');
  document.body.appendChild(mountpoint);
});

afterEach(() => {
  try { render(null, mountpoint); } catch { /* ignore */ }
  api = null;
  teardownDom();
});

describe('useReleaseNotes', () => {
  async function flushEffects() {
    // Generous flush — covers Preact's debounced scheduler + any rAF
    // emulation happy-dom may or may not provide.
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  test('first-ever visit anchors the watermark and returns no pending', async () => {
    embed([
      { ts: '2026-04-01T00:00:00Z', sha: 'aaa1111', message: 'one' },
      { ts: '2026-04-02T00:00:00Z', sha: 'bbb2222', message: 'two' },
    ]);
    // Sanity: the script tag must be findable for the hook to do
    // anything. happy-dom keeps id/getElementById in sync.
    const probe = document.getElementById('bm-release-notes');
    assert.ok(probe, 'embed() should make the script findable by id');
    assert.equal(localStorage.getItem(LS.releaseNotesSeen), null,
      'LS watermark should be unset at start of first-ever test');
    render(h(Harness, {}), mountpoint);
    await flushEffects();
    // A second render forces Preact to flush the effect queue,
    // matching the pattern that works for the other tests in this file.
    render(h(Harness, {}), mountpoint);
    await flushEffects();
    const seen = readString(LS.releaseNotesSeen, '');
    assert.equal(seen, '2026-04-02T00:00:00Z',
      `expected watermark anchored at newest ts; got ${JSON.stringify(seen)}. ` +
      `Embed children: ${(probe?.textContent ?? '').slice(0, 100)}`);
    assert.equal(api!.pending.length, 0,
      'first visit should not flood the user with backlog');
  });

  test('returning user sees notes newer than their watermark', async () => {
    embed([
      { ts: '2026-04-01T00:00:00Z', sha: 'aaa1111', message: 'old' },
      { ts: '2026-04-02T00:00:00Z', sha: 'bbb2222', message: 'newer' },
      { ts: '2026-04-03T00:00:00Z', sha: 'ccc3333', message: 'newest' },
    ]);
    localStorage.setItem(LS.releaseNotesSeen, '2026-04-01T00:00:00Z');
    render(h(Harness, {}), mountpoint);
    await flushEffects();
    // Re-render to pick up the state set inside the effect.
    render(h(Harness, {}), mountpoint);
    assert.equal(api!.pending.length, 2);
    assert.equal(api!.pending[0].message, 'newer');
    assert.equal(api!.pending[1].message, 'newest');
  });

  test('user already at the latest sees no pending', async () => {
    embed([
      { ts: '2026-04-01T00:00:00Z', sha: 'aaa1111', message: 'old' },
    ]);
    localStorage.setItem(LS.releaseNotesSeen, '2026-04-01T00:00:00Z');
    render(h(Harness, {}), mountpoint);
    await flushEffects();
    render(h(Harness, {}), mountpoint);
    assert.equal(api!.pending.length, 0);
  });

  test('dismiss advances the watermark to the newest pending ts', async () => {
    embed([
      { ts: '2026-04-01T00:00:00Z', sha: 'a', message: 'old' },
      { ts: '2026-04-02T00:00:00Z', sha: 'b', message: 'newer' },
      { ts: '2026-04-03T00:00:00Z', sha: 'c', message: 'newest' },
    ]);
    localStorage.setItem(LS.releaseNotesSeen, '2026-04-01T00:00:00Z');
    render(h(Harness, {}), mountpoint);
    await flushEffects();
    render(h(Harness, {}), mountpoint);
    assert.equal(api!.pending.length, 2);
    api!.dismiss();
    render(h(Harness, {}), mountpoint);
    assert.equal(api!.pending.length, 0);
    assert.equal(readString(LS.releaseNotesSeen, ''),
      '2026-04-03T00:00:00Z');
  });

  test('empty embedded list → no pending, no watermark write', async () => {
    embed([]);
    render(h(Harness, {}), mountpoint);
    await flushEffects();
    assert.equal(api!.pending.length, 0);
  });

  test('malformed JSON in the embed → no crash, no pending', async () => {
    embed('this is not json');
    render(h(Harness, {}), mountpoint);
    await flushEffects();
    assert.equal(api!.pending.length, 0);
  });

  test('rejects entries with wrong shape but keeps valid ones', async () => {
    // Embed a mixed-shape array; useReleaseNotes drops bad entries.
    const tag = document.createElement('script');
    tag.id = 'bm-release-notes';
    tag.type = 'application/json';
    tag.textContent = JSON.stringify([
      { ts: '2026-04-01T00:00:00Z', sha: 'a', message: 'good' },
      { ts: 123, sha: 'b', message: 'wrong-ts-type' },
      { sha: 'c', message: 'no-ts' },
    ]);
    document.head.appendChild(tag);
    render(h(Harness, {}), mountpoint);
    await flushEffects();
    render(h(Harness, {}), mountpoint);
    await flushEffects();
    assert.equal(api!.pending.length, 0);
    assert.equal(readString(LS.releaseNotesSeen, ''),
      '2026-04-01T00:00:00Z',
      'watermark should anchor at the only valid note');
  });
});
