import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { h, render } from 'preact';
import { SyncSettings } from '../src/components/SyncSettings';
import type { SyncController } from '../src/hooks/useSync';
import { installDom, teardownDom } from './_dom';

let mount: HTMLElement;

beforeEach(() => {
  installDom();
  mount = document.createElement('div');
  document.body.appendChild(mount);
});

afterEach(() => {
  try { render(null, mount); } catch { /* ignore */ }
  teardownDom();
});

function controller(overrides: Partial<SyncController> = {}): SyncController {
  return {
    available: true,
    connected: false,
    status: 'disconnected',
    message: '',
    lastSyncedAt: null,
    connect: async () => {},
    cancelConnect: () => {},
    syncNow: async () => {},
    disconnect: async () => {},
    ...overrides,
  };
}

describe('Dropbox settings', () => {
  test('stays absent when the build has no sync provider', () => {
    render(h(SyncSettings, { sync: controller({ available: false }) }), mount);
    assert.equal(mount.textContent, '');
  });

  test('offers Connect and invokes authorization from the user click', () => {
    let connects = 0;
    render(h(SyncSettings, {
      sync: controller({ connect: async () => { connects++; } }),
    }), mount);
    const button = mount.querySelector<HTMLButtonElement>('.sync-actions button');
    assert.match(button?.textContent ?? '', /Connect Dropbox/);
    button?.click();
    assert.equal(connects, 1);
  });

  test('connected state exposes explicit sync and disconnect actions', () => {
    let syncs = 0;
    let disconnects = 0;
    render(h(SyncSettings, {
      sync: controller({
        connected: true,
        status: 'synced',
        message: 'Dropbox is up to date.',
        syncNow: async () => { syncs++; },
        disconnect: async () => { disconnects++; },
      }),
    }), mount);
    const buttons = [...mount.querySelectorAll<HTMLButtonElement>('.sync-actions button')];
    assert.equal(buttons.length, 2);
    buttons[0].click();
    buttons[1].click();
    assert.equal(syncs, 1);
    assert.equal(disconnects, 1);
    assert.match(mount.textContent ?? '', /Dropbox is up to date/);
  });

  test('does not offer authorization while restoring a saved session', () => {
    let connects = 0;
    render(h(SyncSettings, {
      sync: controller({
        status: 'checking',
        connect: async () => { connects++; },
      }),
    }), mount);
    const button = mount.querySelector<HTMLButtonElement>('.sync-actions button');
    assert.equal(button?.disabled, true);
    assert.match(button?.textContent ?? '', /Checking Dropbox connection/);
    button?.click();
    assert.equal(connects, 0);
  });

  test('expired sessions require an explicit reconnect click', () => {
    let connects = 0;
    render(h(SyncSettings, {
      sync: controller({
        status: 'expired',
        connect: async () => { connects++; },
      }),
    }), mount);
    const button = mount.querySelector<HTMLButtonElement>('.sync-actions button');
    assert.match(button?.textContent ?? '', /Reconnect Dropbox/);
    assert.equal(connects, 0);
    button?.click();
    assert.equal(connects, 1);
  });

  test('a pending popup can be cancelled immediately and retried', () => {
    let cancels = 0;
    render(h(SyncSettings, {
      sync: controller({
        status: 'connecting',
        cancelConnect: () => { cancels++; },
      }),
    }), mount);
    const button = mount.querySelector<HTMLButtonElement>('.sync-actions button');
    assert.equal(button?.disabled, false);
    assert.match(button?.textContent ?? '', /Cancel Dropbox sign-in/);
    button?.click();
    assert.equal(cancels, 1);
  });
});
