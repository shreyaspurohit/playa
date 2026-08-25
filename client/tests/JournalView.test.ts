import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { h, render } from 'preact';
import { useJournal } from '../src/hooks/useJournal';
import { JournalView } from '../src/components/JournalView';
import { clearJournalData, upsertEntry } from '../src/utils/journalDb';
import { LS } from '../src/types';
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
    const year = document.createElement('meta');
    year.name = 'bm-brc-map-year';
    year.content = '2026';
    document.head.appendChild(year);
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

  test('opens today by Playa date rather than the device calendar date', async () => {
    // This instant is already 8/31 in UTC but remains 8/30 on Playa.
    localStorage.setItem(LS.mockNow, '2026-08-30T23:30:00-07:00');
    await upsertEntry(
      { burnYear: 2026, occurredAt: '2026-08-31T10:00', createdAt: 3, text: 'newest' },
      undefined, 1003,
    );
    await upsertEntry(
      { burnYear: 2026, occurredAt: '2026-08-30T10:00', createdAt: 2, text: 'playa today' },
      undefined, 1002,
    );
    await upsertEntry(
      { burnYear: 2026, occurredAt: '2026-08-29T10:00', createdAt: 1, text: 'older' },
      undefined, 1001,
    );

    render(h(Harness, { standalone: false }), mount);
    await waitFor(seen(/playa today/));
    const groups = Array.from(
      mount.querySelectorAll<HTMLDetailsElement>('.journal-day-group'),
    );
    const openLabels = groups
      .filter((group) => group.open)
      .map((group) => group.querySelector('.journal-day-label')?.textContent);
    assert.deepEqual(openLabels, ['Mon · Aug 31', 'Sun · Aug 30']);
  });
});
