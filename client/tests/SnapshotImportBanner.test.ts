import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { h, render } from 'preact';
import { installDom, teardownDom } from './_dom';
import { SnapshotImportBanner } from '../src/components/SnapshotImportBanner';
import { SNAPSHOT_SCHEMA, type Snapshot } from '../src/utils/exportImport';

const legacySnapshot: Snapshot = {
  schema: SNAPSHOT_SCHEMA,
  exportedAt: '2026-04-24T16:00:00Z',
  nickname: '',
  campFavs: ['123'],
  eventFavs: [],
  myCampId: '',
  meetSpots: [],
  hiddenDays: [],
  friends: {},
};

describe('SnapshotImportBanner legacy compatibility', () => {
  beforeEach(() => {
    teardownDom();
    installDom();
  });

  afterEach(() => teardownDom());

  test('offers anonymous old exports only as a self-restore', () => {
    let restored = false;
    let importedFriend = false;
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(h(SnapshotImportBanner, {
      snapshot: legacySnapshot,
      ownNickname: 'Alice',
      onApplySelf: () => { restored = true; },
      onImportAsFriend: () => { importedFriend = true; },
      onDismiss: () => {},
    }), host);

    assert.match(host.textContent ?? '', /current nickname will be preserved/);
    assert.doesNotMatch(host.textContent ?? '', /Import as "unknown"/);
    const restore = [...host.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.includes('Restore legacy snapshot'));
    assert.ok(restore);
    restore!.click();
    assert.equal(restored, true);
    assert.equal(importedFriend, false);
  });
});
