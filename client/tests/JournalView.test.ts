import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { h, render } from 'preact';
import { useJournal } from '../src/hooks/useJournal';
import { JournalView } from '../src/components/JournalView';
import { clearJournalData, upsertEntry } from '../src/utils/journalDb';
import { installDom, teardownDom } from './_dom';

let mount: HTMLElement;

async function waitFor(test: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now();
  while (!test()) {
    if (Date.now() - start > timeout) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}
const seen = (re: RegExp) => () => re.test(mount.textContent ?? '');

// JournalView now takes the journal controller as a prop. Drive it through the
// real useJournal() hook so these stay DB-integration tests against fake-indexeddb.
function Harness({ standalone = false }: { standalone?: boolean }) {
  const journal = useJournal();
  return h(JournalView, { standalone, journal });
}

describe('<JournalView>', () => {
  beforeEach(async () => {
    installDom();
    await clearJournalData();
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });
  afterEach(async () => {
    render(null, mount);
    await clearJournalData();
    teardownDom();
  });

  test('renders the empty state and an Add entry action', async () => {
    render(h(Harness, { standalone: false }), mount);
    await waitFor(seen(/Add entry/));
    assert.match(mount.textContent ?? '', /Add entry/);
    assert.match(mount.textContent ?? '', /write your first memory/);
  });

  test('shows an existing entry grouped under its burn year', async () => {
    await upsertEntry(
      { burnYear: 2026, occurredAt: '2026-08-28T22:30', createdAt: 1, text: 'dusty sunset' },
      undefined, 1000,
    );
    render(h(Harness, { standalone: false }), mount);
    await waitFor(seen(/dusty sunset/));
    assert.match(mount.textContent ?? '', /2026/);
    assert.match(mount.textContent ?? '', /dusty sunset/);
    assert.doesNotMatch(mount.textContent ?? '', /No entries yet/);
  });
});
