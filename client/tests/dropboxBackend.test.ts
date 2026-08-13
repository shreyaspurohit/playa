import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, teardownDom } from './_dom';
import { LS } from '../src/types';
import type { SyncConfig } from '../src/sync/config';

const CONFIG: SyncConfig = {
  provider: 'dropbox',
  clientId: 'key',
};

beforeEach(async () => {
  installDom();
  if (!globalThis.crypto?.subtle) {
    const nodeCrypto = (await import('node:crypto')).webcrypto;
    Object.defineProperty(globalThis, 'crypto', {
      value: nodeCrypto, configurable: true, writable: true,
    });
  }
});

afterEach(() => {
  try { indexedDB.deleteDatabase('playa-camps-secure'); } catch { /* ignore */ }
  try { localStorage.clear(); } catch { /* ignore */ }
  teardownDom();
});

async function connectedBackend(fetchFn: typeof fetch) {
  const { cacheSecureValue } = await import('../src/utils/secureStore');
  await cacheSecureValue(LS.syncToken, JSON.stringify({
    accessToken: 'short-token', expiresAt: 500_000,
  }));
  const { DropboxBackend } = await import('../src/sync/dropboxBackend');
  return new DropboxBackend(CONFIG, fetchFn, () => 1_000);
}

describe('Dropbox SDK adapter', () => {
  test('receives an OAuth callback when a privacy browser severs window.opener', async () => {
    const channels: FakeBroadcastChannel[] = [];
    class FakeBroadcastChannel {
      onmessage: ((event: MessageEvent) => void) | null = null;
      closed = false;
      constructor(readonly name: string) { channels.push(this); }
      close() { this.closed = true; }
      emit(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
    }
    Object.defineProperty(window, 'BroadcastChannel', {
      value: FakeBroadcastChannel, configurable: true,
    });
    let popupClosed = false;
    const popup = { close: () => { popupClosed = true; } } as unknown as Window;
    const { waitForOAuth } = await import('../src/sync/dropboxBackend');

    const result = waitForOAuth(popup, 'pc_expected');
    assert.equal(channels[0].name, 'playa-dropbox-oauth');
    channels[0].emit({
      type: 'PLAYA_DROPBOX_OAUTH', state: 'pc_other', code: 'wrong-code',
    });
    channels[0].emit({
      type: 'PLAYA_DROPBOX_OAUTH', state: 'pc_expected', code: 'right-code',
    });

    assert.equal(await result, 'right-code');
    assert.equal(popupClosed, true);
    assert.equal(channels[0].closed, true);
  });

  test('downloads the app-folder file and reads its revision header', async () => {
    let request: { url: string; init?: RequestInit } | null = null;
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      request = { url: String(url), init };
      return new Response('{"schema":"playa-sync-v1"}', {
        status: 200,
        headers: { 'Dropbox-API-Result': JSON.stringify({ rev: 'rev-1' }) },
      });
    }) as typeof fetch;
    const backend = await connectedBackend(fetchFn);
    const file = await backend.readFile();
    assert.equal(file.revision, 'rev-1');
    assert.match(file.text!, /playa-sync-v1/);
    assert.equal(request!.url, 'https://content.dropboxapi.com/2/files/download');
    const headers = new Headers(request!.init?.headers);
    assert.equal(headers.get('Authorization'), 'Bearer short-token');
    assert.deepEqual(JSON.parse(headers.get('Dropbox-API-Arg')!), { path: '/playa-sync.json' });
  });

  test('uploads with revision-checked update mode', async () => {
    let arg: Record<string, unknown> | null = null;
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      arg = JSON.parse(headers.get('Dropbox-API-Arg')!);
      return new Response(JSON.stringify({ rev: 'rev-2' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    const backend = await connectedBackend(fetchFn);
    assert.equal(await backend.writeFile('{}', 'rev-1'), 'rev-2');
    assert.deepEqual(arg!.mode, { '.tag': 'update', update: 'rev-1' });
    assert.equal(arg!.autorename, false);
    assert.equal(arg!.strict_conflict, true);
  });

  test('treats a missing backup as an empty remote', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({
      error_summary: 'path/not_found/...',
    }), { status: 409 })) as typeof fetch;
    const backend = await connectedBackend(fetchFn);
    assert.deepEqual(await backend.readFile(), { text: null, revision: null });
  });

  test('does not mistake another Dropbox path error for a missing backup', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({
      error_summary: 'path/insufficient_space/...',
    }), { status: 409 })) as typeof fetch;
    const backend = await connectedBackend(fetchFn);
    await assert.rejects(() => backend.readFile(), /could not read/);
  });

  test('refreshes offline PKCE sessions without an app secret', async () => {
    const { cacheSecureValue, loadSecureValue } = await import('../src/utils/secureStore');
    await cacheSecureValue(LS.syncToken, JSON.stringify({
      version: 2,
      accessToken: 'expired-token',
      expiresAt: 1,
      refreshToken: 'long-lived-refresh',
    }));
    const requests: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      const requestUrl = String(url);
      requests.push(requestUrl);
      if (requestUrl.startsWith('https://api.dropboxapi.com/oauth2/token')) {
        const parsed = new URL(requestUrl);
        assert.equal(parsed.searchParams.get('grant_type'), 'refresh_token');
        assert.equal(parsed.searchParams.get('refresh_token'), 'long-lived-refresh');
        assert.equal(parsed.searchParams.get('client_id'), 'key');
        assert.equal(parsed.searchParams.has('client_secret'), false);
        return new Response(JSON.stringify({ access_token: 'fresh-token', expires_in: 14400 }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', {
        status: 200,
        headers: { 'Dropbox-API-Result': JSON.stringify({ rev: 'rev-3' }) },
      });
    }) as typeof fetch;
    const { DropboxBackend } = await import('../src/sync/dropboxBackend');
    const backend = new DropboxBackend(CONFIG, fetchFn);
    assert.equal((await backend.readFile()).revision, 'rev-3');
    assert.equal(requests.length, 2);
    const stored = JSON.parse((await loadSecureValue(LS.syncToken))!);
    assert.equal(stored.accessToken, 'fresh-token');
    assert.equal(stored.refreshToken, 'long-lived-refresh');
  });

  test('uses a receiver-safe default fetch for Firefox Window.fetch', async () => {
    const originalFetch = globalThis.fetch;
    let receiver: unknown;
    globalThis.fetch = function (this: unknown) {
      receiver = this;
      return Promise.resolve(new Response('{}', { status: 200 }));
    } as typeof fetch;
    try {
      const { DropboxBackend } = await import('../src/sync/dropboxBackend');
      const backend = new DropboxBackend(CONFIG);
      // Reach the injected adapter directly; OAuth itself is intentionally
      // popup-driven and need not be part of this receiver test.
      const fetchFn = (backend as unknown as { fetchFn: typeof fetch }).fetchFn;
      await fetchFn('https://example.test/');
      assert.equal(receiver, globalThis);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('standalone redirect persists PKCE state and navigates the top window', async () => {
    const { DropboxBackend } = await import('../src/sync/dropboxBackend');
    let navigated = '';
    const backend = new DropboxBackend(CONFIG, undefined, () => 1_000, (url) => { navigated = url; });
    await backend.beginRedirectAuth();
    assert.match(navigated, /dropbox\.com\/oauth2\/authorize/);
    assert.match(navigated, /response_type=code/);
    assert.match(navigated, /code_challenge=/);
    const pending = JSON.parse(localStorage.getItem(LS.syncAuthPending)!);
    assert.ok(pending.state.startsWith('pcr_'), 'redirect state uses the pcr_ prefix');
    assert.ok(pending.verifier.length > 0, 'PKCE verifier is persisted for the return trip');
    assert.match(navigated, new RegExp(`state=${pending.state}`));
  });

  test('completing the redirect exchanges the code for a wrapped offline session', async () => {
    const { DropboxBackend } = await import('../src/sync/dropboxBackend');
    const { loadSecureValue } = await import('../src/utils/secureStore');
    let tokenRequested = false;
    const fetchFn = (async (url: string | URL | Request) => {
      if (String(url).startsWith('https://api.dropboxapi.com/oauth2/token')) {
        tokenRequested = true;
        return new Response(JSON.stringify({
          access_token: 'redir-token', expires_in: 14400, refresh_token: 'redir-refresh',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const backend = new DropboxBackend(CONFIG, fetchFn, () => 1_000, () => {});
    await backend.beginRedirectAuth();
    const pending = JSON.parse(localStorage.getItem(LS.syncAuthPending)!);
    location.href = `http://localhost/?code=the-code&state=${pending.state}#food`;

    assert.equal(await backend.completeRedirectAuth(), true);
    assert.equal(tokenRequested, true);
    const stored = JSON.parse((await loadSecureValue(LS.syncToken))!);
    assert.equal(stored.accessToken, 'redir-token');
    assert.equal(stored.refreshToken, 'redir-refresh');
    assert.equal(localStorage.getItem(LS.syncAuthPending), null);
    assert.equal(location.search, '');       // replayable params stripped
    assert.equal(location.hash, '#food');     // app route preserved
  });

  test('a boot without an OAuth callback stays offline and idempotent', async () => {
    let fetched = false;
    const fetchFn = (async () => { fetched = true; return new Response('{}', { status: 200 }); }) as typeof fetch;
    const { DropboxBackend } = await import('../src/sync/dropboxBackend');
    const backend = new DropboxBackend(CONFIG, fetchFn, () => 1_000, () => {});
    location.href = 'http://localhost/#food';
    assert.equal(await backend.completeRedirectAuth(), false);
    assert.equal(fetched, false);
  });

  test('a mismatched callback state is rejected and cleared without exchanging', async () => {
    let fetched = false;
    const fetchFn = (async () => { fetched = true; return new Response('{}', { status: 200 }); }) as typeof fetch;
    const { DropboxBackend } = await import('../src/sync/dropboxBackend');
    const backend = new DropboxBackend(CONFIG, fetchFn, () => 1_000, () => {});
    await backend.beginRedirectAuth();
    location.href = 'http://localhost/?code=the-code&state=pcr_tampered';
    await assert.rejects(() => backend.completeRedirectAuth(), /could not be verified/);
    assert.equal(fetched, false);
    assert.equal(localStorage.getItem(LS.syncAuthPending), null);
    assert.equal(location.search, '');
  });

  test('a denied authorization surfaces a cancellation and clears pending state', async () => {
    const { DropboxBackend } = await import('../src/sync/dropboxBackend');
    const backend = new DropboxBackend(CONFIG, undefined, () => 1_000, () => {});
    await backend.beginRedirectAuth();
    const pending = JSON.parse(localStorage.getItem(LS.syncAuthPending)!);
    location.href = `http://localhost/?error=access_denied&state=${pending.state}`;
    await assert.rejects(() => backend.completeRedirectAuth(), /cancelled/);
    assert.equal(localStorage.getItem(LS.syncAuthPending), null);
  });

  test('a blocked popup raises SyncPopupBlockedError so callers can fall back', async () => {
    const { DropboxBackend } = await import('../src/sync/dropboxBackend');
    const { SyncPopupBlockedError } = await import('../src/sync/SyncBackend');
    const originalOpen = window.open;
    (window as unknown as { open: unknown }).open = () => null;
    try {
      const backend = new DropboxBackend(CONFIG, undefined, () => 1_000, () => {});
      await assert.rejects(() => backend.authorize(), (e) => e instanceof SyncPopupBlockedError);
    } finally {
      (window as unknown as { open: unknown }).open = originalOpen;
    }
  });
});
