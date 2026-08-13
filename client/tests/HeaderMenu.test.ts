import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { h, render } from 'preact';
import { HeaderMenu } from '../src/components/HeaderMenu';
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

async function mountMenu(overrides: Partial<Parameters<typeof HeaderMenu>[0]> = {}) {
  const calls = { syncNow: 0, connect: 0, cancel: 0, disconnect: 0, settings: 0 };
  render(h(HeaderMenu, {
    source: 'directory',
    availableSources: ['directory'],
    onSourceChange: () => {},
    currentTheme: 'paper',
    onThemeChange: () => {},
    onInfoClick: () => {},
    onSyncNow: () => { calls.syncNow += 1; },
    onSyncConnect: () => { calls.connect += 1; },
    onSyncCancel: () => { calls.cancel += 1; },
    onSyncDisconnect: () => { calls.disconnect += 1; },
    infoPulse: false,
    syncAvailable: true,
    syncConnected: false,
    syncStatus: 'disconnected',
    ...overrides,
  }), mount);
  mount.querySelector<HTMLButtonElement>('.header-menu-trigger')?.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return calls;
}

describe('header Dropbox sync entry', { concurrency: false }, () => {
  test('shows the Dropbox folder notice before authorization', async () => {
    const calls = await mountMenu();
    const action = mount.querySelector<HTMLButtonElement>('.header-menu-sync');

    assert.ok(action);
    assert.match(action.textContent ?? '', /Dropbox sync/);
    assert.match(action.textContent ?? '', /Back up, restore & keep plans aligned/);
    assert.equal(action.querySelector('svg path')?.getAttribute('fill'), '#0061ff');

    action.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(mount.textContent ?? '', /Apps → Playa Camps Sync/);
    assert.match(mount.textContent ?? '', /Other Dropbox files are not accessible/);
    assert.equal(calls.connect, 0);
    mount.querySelector<HTMLButtonElement>('.header-menu-sync-note-continue')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls.connect, 1);
    assert.equal(calls.syncNow, 0);
    assert.equal(mount.querySelector('.header-menu-panel'), null);
  });

  test('connected click syncs in place and can never open authorization settings', async () => {
    const calls = await mountMenu({ syncConnected: true, syncStatus: 'synced' });
    const action = mount.querySelector<HTMLButtonElement>('.header-menu-sync');
    assert.match(action?.textContent ?? '', /Connected · tap to sync now/);

    action?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(calls.syncNow, 1);
    assert.ok(mount.querySelector('.header-menu-panel'));
  });

  test('connected menu exposes a direct disconnect action', async () => {
    const calls = await mountMenu({ syncConnected: true, syncStatus: 'synced' });
    const action = mount.querySelector<HTMLButtonElement>('.header-menu-sync-disconnect');
    assert.ok(action);
    action.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls.disconnect, 1);
    assert.equal(mount.querySelector('.header-menu-panel'), null);
  });

  test('disables the action while the saved session is being restored', async () => {
    const calls = await mountMenu({ syncConnected: false, syncStatus: 'checking' });
    const action = mount.querySelector<HTMLButtonElement>('.header-menu-sync');
    assert.equal(action?.disabled, true);
    assert.match(action?.textContent ?? '', /Checking saved connection/);
    action?.click();
    assert.deepEqual(calls, {
      syncNow: 0, connect: 0, cancel: 0, disconnect: 0, settings: 0,
    });
  });

  test('a connecting row cancels immediately and exposes retry', async () => {
    const calls = await mountMenu({ syncConnected: false, syncStatus: 'connecting' });
    const action = mount.querySelector<HTMLButtonElement>('.header-menu-sync');
    assert.equal(action?.disabled, false);
    assert.equal(action?.getAttribute('aria-label'), 'Cancel Dropbox sign-in');
    assert.match(action?.textContent ?? '', /tap to cancel/);

    action?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(calls.cancel, 1);
    assert.ok(mount.querySelector('.header-menu-sync-note'));
  });

  test('is absent from builds without sync configuration', async () => {
    await mountMenu({ syncAvailable: false, syncStatus: 'unavailable' });
    assert.equal(mount.querySelector('.header-menu-sync'), null);
  });
});
