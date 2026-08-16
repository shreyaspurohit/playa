import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { h, render } from 'preact';
import { Footer } from '../src/components/Footer';
import { GuideTab, InfoModal } from '../src/components/InfoModal';
import type { SyncController } from '../src/hooks/useSync';
import type { Source } from '../src/types';
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

function mountInfo(source: Source) {
  render(h(InfoModal, {
    open: true,
    fetchedDate: '2026-08-06',
    contactEmail: 'test@example.com',
    source,
    locationPolicy: {
      year: 2026,
      campReleaseAt: '2026-08-23T00:00:00-07:00',
      artReleaseAt: '2026-08-30T00:00:00-07:00',
    },
    onImport: () => {},
    onExport: () => {},
    onClose: () => {},
  }), mount);
}

describe('source-specific directory disclaimer', () => {
  test('footer shows directory information for the directory source', () => {
    render(h(Footer, {
      fetchedDate: '2026-08-06',
      contactEmail: 'test@example.com',
      source: 'directory',
    }), mount);

    assert.match(mount.textContent ?? '', /official Burning Man Playa Info directory/);
    assert.match(mount.textContent ?? '', /Email a takedown request/);
    assert.equal(
      mount.querySelector<HTMLAnchorElement>('a[href="./privacy.html"]')?.textContent,
      'Privacy Policy',
    );
  });

  test('footer omits directory information for an API source', () => {
    render(h(Footer, {
      fetchedDate: '2026-08-06',
      contactEmail: 'test@example.com',
      source: 'api-2026',
    }), mount);

    assert.doesNotMatch(mount.textContent ?? '', /directory\.burningman\.org/i);
    assert.doesNotMatch(mount.textContent ?? '', /Email a takedown request/);
    assert.match(mount.textContent ?? '', /not affiliated, endorsed, or verified/);
    assert.ok(mount.querySelector('a[href="./privacy.html"]'));
  });

  test('About shows directory information only for the directory source', () => {
    mountInfo('directory');
    assert.match(mount.textContent ?? '', /Always verify on/);
    assert.match(mount.textContent ?? '', /directory\.burningman\.org/);

    mountInfo('api-2026');
    assert.doesNotMatch(mount.textContent ?? '', /Always verify on/);
    assert.doesNotMatch(mount.textContent ?? '', /directory\.burningman\.org/);
    assert.match(mount.textContent ?? '', /not affiliated, endorsed, or verified/);
    assert.match(mount.textContent ?? '', /Tags are generated from listing text/);
    assert.match(mount.textContent ?? '', /event times are formatted/);
    assert.match(mount.textContent ?? '', /no commercial purpose/);
    assert.match(mount.textContent ?? '', /Camp location is shown on August 23 at 12:00 AM PDT/);
    assert.match(mount.textContent ?? '', /art location is shown on August 30 at 12:00 AM PDT/);
    assert.doesNotMatch(mount.textContent ?? '', /selected source|normal\/spirit|Before each cutoff|only that location field is hidden/i);
    assert.match(mount.textContent ?? '', /Events use their camp’s location/);
    assert.match(mount.textContent ?? '', /Use my GPS/);
    assert.match(mount.textContent ?? '', /Near me/);
    assert.match(mount.textContent ?? '', /stop that location watch/);
    assert.match(mount.textContent ?? '', /Read the Playa Camps Privacy Policy/);
    assert.ok(mount.querySelector('a[href="./privacy.html"]'));
    assert.doesNotMatch(mount.textContent ?? '', /\?(?:gps|now)=/);
  });

  test('How to use covers current tabs and normal GPS controls without developer URLs', () => {
    render(h(GuideTab, {}), mount);
    const copy = mount.textContent ?? '';
    assert.match(copy, /Find camps and art/);
    assert.match(copy, /Find food/);
    assert.match(copy, /Hours not listed/);
    assert.match(copy, /Tap the active button again/);
    assert.match(copy, /Build your schedule/);
    assert.match(copy, /The map \+ GPS/);
    assert.match(copy, /scrolling down hides the global header/);
    assert.match(copy, /top-right menu/);
    assert.doesNotMatch(copy, /\?(?:gps|now)=/);
  });

  test('Dropbox section explains multi-device, browser, and tab sync', () => {
    const sync: SyncController = {
      available: true,
      connected: false,
      status: 'disconnected',
      message: '',
      lastSyncedAt: null,
      connect: async () => {},
      cancelConnect: () => {},
      syncNow: async () => {},
      disconnect: async () => {},
    };
    render(h(InfoModal, {
      open: true,
      fetchedDate: '2026-08-06',
      contactEmail: 'test@example.com',
      source: 'api-2026',
      locationPolicy: {
        year: 2026,
        campReleaseAt: '2026-08-23T00:00:00-07:00',
        artReleaseAt: '2026-08-30T00:00:00-07:00',
      },
      sync,
      onImport: () => {},
      onExport: () => {},
      onClose: () => {},
    }), mount);

    const section = mount.querySelector('.sync-settings');
    assert.ok(section);
    assert.match(section.textContent ?? '', /devices, browsers, and tabs/);
    assert.match(section.textContent ?? '', /Apps → Playa Camps Sync/);
    assert.match(section.textContent ?? '', /cannot access your other Dropbox files/);
  });

  test('Clear all local data removes persisted map-layer preferences', () => {
    localStorage.setItem('bm-map-layers/v1', '["boundary","arrival"]');
    Object.defineProperty(globalThis, 'confirm', {
      configurable: true,
      value: () => true,
    });
    mountInfo('directory');

    const clear = [...mount.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Clear all local data'));
    assert.ok(clear);
    clear.click();

    assert.equal(localStorage.getItem('bm-map-layers/v1'), null);
    delete (globalThis as { confirm?: () => boolean }).confirm;
  });
});
