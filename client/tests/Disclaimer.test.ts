import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { h, render } from 'preact';
import { Footer } from '../src/components/Footer';
import { InfoModal } from '../src/components/InfoModal';
import type { Source } from '../src/types';
import { installDom, teardownDom } from './_dom';

let mount: HTMLElement;

beforeEach(() => {
  installDom();
  mount = document.createElement('div');
  document.body.appendChild(mount);
});

afterEach(() => {
  teardownDom();
});

function mountInfo(source: Source) {
  render(h(InfoModal, {
    open: true,
    fetchedDate: '2026-08-06',
    contactEmail: 'test@example.com',
    source,
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
  });

  test('About shows directory information only for the directory source', () => {
    mountInfo('directory');
    assert.match(mount.textContent ?? '', /Always verify on/);
    assert.match(mount.textContent ?? '', /directory\.burningman\.org/);

    mountInfo('api-2026');
    assert.doesNotMatch(mount.textContent ?? '', /Always verify on/);
    assert.doesNotMatch(mount.textContent ?? '', /directory\.burningman\.org/);
    assert.match(mount.textContent ?? '', /not affiliated, endorsed, or verified/);
    assert.match(mount.textContent ?? '', /tags are keyword-matched by this app/);
    assert.match(mount.textContent ?? '', /Event times are normalized/);
    assert.match(mount.textContent ?? '', /no commercial purpose/);
  });
});
