import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { DropboxAuth } from 'dropbox';
import { installDom, teardownDom } from './_dom';
import { readSyncConfig } from '../src/sync/config';
import { buildDropboxAuthorizeUrl } from '../src/sync/dropboxBackend';

describe('Dropbox sync configuration', () => {
  beforeEach(() => {
    installDom();
    Object.defineProperty(globalThis, 'crypto', {
      value: webcrypto, configurable: true, writable: true,
    });
  });
  afterEach(() => teardownDom());

  test('stays unavailable when build metadata is absent', () => {
    assert.equal(readSyncConfig(), null);
  });

  test('reads build metadata and creates an offline least-privilege PKCE request', async () => {
    const values: Record<string, string> = {
      'bm-sync-provider': 'dropbox',
      'bm-sync-client-id': 'app-key',
    };
    for (const [name, content] of Object.entries(values)) {
      const meta = document.createElement('meta');
      meta.name = name;
      meta.content = content;
      document.head.appendChild(meta);
    }
    const config = readSyncConfig();
    assert.ok(config);
    let tokenRequest = '';
    const fetchFn = (async (input: string | URL | Request) => {
      tokenRequest = String(input);
      return new Response(JSON.stringify({ access_token: 'token', expires_in: 14400 }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    const auth = new DropboxAuth({ clientId: config!.clientId, fetch: fetchFn });
    const url = new URL(await buildDropboxAuthorizeUrl(
      auth, 'https://playa.example/', 'pc_state',
    ));
    assert.equal(url.searchParams.get('client_id'), 'app-key');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('token_access_type'), 'offline');
    assert.equal(url.searchParams.get('state'), 'pc_state');
    assert.equal(url.searchParams.get('scope'), 'files.content.read files.content.write');
    assert.ok(url.searchParams.get('code_challenge'));
    assert.equal(url.searchParams.has('client_secret'), false);

    await auth.getAccessTokenFromCode('https://playa.example/', 'oauth-code');
    const exchange = new URL(tokenRequest);
    assert.equal(exchange.searchParams.get('client_id'), 'app-key');
    assert.equal(exchange.searchParams.get('code'), 'oauth-code');
    assert.ok(exchange.searchParams.get('code_verifier'));
    assert.equal(exchange.searchParams.has('client_secret'), false);
  });
});
