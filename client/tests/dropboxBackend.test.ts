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

  test('returns promptly when the user closes the OAuth popup', async () => {
    let popupClosed = false;
    const popup = {
      get closed() { return popupClosed; },
      close: () => { popupClosed = true; },
    } as unknown as Window;
    const { waitForOAuth } = await import('../src/sync/dropboxBackend');

    const result = waitForOAuth(popup, 'pc_expected', undefined, 0);
    window.dispatchEvent(new Event('blur'));
    popupClosed = true;
    window.dispatchEvent(new Event('focus'));

    await assert.rejects(result, /cancelled/);
  });

  test('accepts a valid callback delivered after focus returns and the popup closes', async () => {
    const channels: FakeBroadcastChannel[] = [];
    class FakeBroadcastChannel {
      onmessage: ((event: MessageEvent) => void) | null = null;
      constructor(_name: string) { channels.push(this); }
      close() {}
      emit(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
    }
    Object.defineProperty(window, 'BroadcastChannel', {
      value: FakeBroadcastChannel, configurable: true,
    });
    let popupClosed = false;
    const popup = {
      get closed() { return popupClosed; },
      close: () => { popupClosed = true; },
    } as unknown as Window;
    const { waitForOAuth } = await import('../src/sync/dropboxBackend');

    const result = waitForOAuth(popup, 'pc_expected', undefined, 30);
    window.dispatchEvent(new Event('blur'));
    popupClosed = true;
    window.dispatchEvent(new Event('focus'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    channels[0].emit({
      type: 'PLAYA_DROPBOX_OAUTH', state: 'pc_expected', code: 'valid-code',
    });

    assert.equal(await result, 'valid-code');
  });

  test('recovers the code from the durable handoff when the popup closes and no message arrives', async () => {
    let popupClosed = false;
    const popup = {
      get closed() { return popupClosed; },
      close: () => { popupClosed = true; },
    } as unknown as Window;
    const { waitForOAuth } = await import('../src/sync/dropboxBackend');

    const result = waitForOAuth(popup, 'pc_expected', undefined, 0);
    // The popup wrote its result to localStorage just before closing, but both
    // the postMessage and BroadcastChannel deliveries were lost/late. The
    // close-check must recover the code here instead of reporting a cancel.
    localStorage.setItem('bm-sync-oauth-result/pc_expected', JSON.stringify({
      state: 'pc_expected', code: 'late-code', error: '', at: Date.now(),
    }));
    window.dispatchEvent(new Event('blur'));
    popupClosed = true;
    window.dispatchEvent(new Event('focus'));

    assert.equal(await result, 'late-code');
    // The consumed handoff must not linger for a later attempt to replay.
    assert.equal(localStorage.getItem('bm-sync-oauth-result/pc_expected'), null);
  });

  test('a concurrent attempt in another tab is neither clobbered nor consumed', async () => {
    let popupClosed = false;
    const popup = {
      get closed() { return popupClosed; },
      close: () => { popupClosed = true; },
    } as unknown as Window;
    // A fresh record from a *different* tab's attempt must be left intact, and
    // this wait's genuine popup-close still reported as a cancellation.
    localStorage.setItem('bm-sync-oauth-result/pc_other', JSON.stringify({
      state: 'pc_other', code: 'other-tab-code', error: '', at: Date.now(),
    }));
    const { waitForOAuth } = await import('../src/sync/dropboxBackend');

    const result = waitForOAuth(popup, 'pc_expected', undefined, 0);
    window.dispatchEvent(new Event('blur'));
    popupClosed = true;
    window.dispatchEvent(new Event('focus'));

    await assert.rejects(result, /cancelled/);
    // The other tab's still-fresh record survives for its own wait to recover.
    assert.notEqual(localStorage.getItem('bm-sync-oauth-result/pc_other'), null);
  });

  test('two concurrent waits each recover their own state-scoped handoff', async () => {
    const mkPopup = () => {
      let closed = false;
      const popup = {
        get closed() { return closed; },
        close: () => { closed = true; },
      } as unknown as Window;
      return { popup, close: () => { closed = true; } };
    };
    const a = mkPopup();
    const b = mkPopup();
    const { waitForOAuth } = await import('../src/sync/dropboxBackend');

    const rA = waitForOAuth(a.popup, 'pc_a', undefined, 0);
    const rB = waitForOAuth(b.popup, 'pc_b', undefined, 0);
    localStorage.setItem('bm-sync-oauth-result/pc_a', JSON.stringify({
      state: 'pc_a', code: 'code-a', error: '', at: Date.now(),
    }));
    localStorage.setItem('bm-sync-oauth-result/pc_b', JSON.stringify({
      state: 'pc_b', code: 'code-b', error: '', at: Date.now(),
    }));
    window.dispatchEvent(new Event('blur'));
    a.close();
    b.close();
    window.dispatchEvent(new Event('focus'));

    assert.equal(await rA, 'code-a');
    assert.equal(await rB, 'code-b');
  });

  test('an explicit cancellation aborts the OAuth wait and closes the popup', async () => {
    let popupClosed = false;
    const popup = {
      closed: false,
      close: () => { popupClosed = true; },
    } as unknown as Window;
    const abort = new AbortController();
    const { waitForOAuth } = await import('../src/sync/dropboxBackend');

    const result = waitForOAuth(popup, 'pc_expected', abort.signal);
    abort.abort();

    await assert.rejects(result, /cancelled/);
    assert.equal(popupClosed, true);
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

  test('disconnect removes the local session before remote revocation finishes', async () => {
    const pendingRevoke: { finish?: (response: Response) => void } = {};
    const fetchFn = (() => new Promise<Response>((resolve) => { pendingRevoke.finish = resolve; })) as typeof fetch;
    const backend = await connectedBackend(fetchFn);

    const disconnecting = backend.disconnect();
    assert.equal(localStorage.getItem(LS.syncToken), null);
    // Let session decryption reach the best-effort revocation request.
    while (!pendingRevoke.finish) await new Promise((resolve) => setTimeout(resolve, 0));
    pendingRevoke.finish(new Response('{}', { status: 200 }));
    await disconnecting;
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
