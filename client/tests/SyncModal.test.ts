import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { h, render } from 'preact';
import { SyncModal } from '../src/components/SyncModal';
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

describe('dedicated Dropbox sync modal', () => {
  test('uses a Dropbox-specific title rather than the About dialog', () => {
    render(h(SyncModal, {
      open: true,
      sync: controller(),
      onClose: () => {},
    }), mount);

    assert.equal(mount.querySelector('#sync-modal-title')?.textContent, 'Dropbox sync');
    assert.equal(mount.querySelector('#info-title'), null);
    assert.match(mount.textContent ?? '', /Connect Dropbox/);
  });

  test('requires a separate explicit click before authorization', () => {
    let connects = 0;
    render(h(SyncModal, {
      open: true,
      sync: controller({ connect: async () => { connects++; } }),
      onClose: () => {},
    }), mount);

    assert.equal(connects, 0);
    mount.querySelector<HTMLButtonElement>('.sync-actions button')?.click();
    assert.equal(connects, 1);
  });

  test('closes from its own close button', () => {
    let closes = 0;
    render(h(SyncModal, {
      open: true,
      sync: controller(),
      onClose: () => { closes++; },
    }), mount);

    mount.querySelector<HTMLButtonElement>('[aria-label="Close Dropbox sync"]')?.click();
    assert.equal(closes, 1);
  });
});
