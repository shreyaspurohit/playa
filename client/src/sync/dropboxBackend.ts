import { Dropbox, DropboxAuth } from 'dropbox';
import { LS } from '../types';
import { cacheSecureValue, clearSecureValue, loadSecureValue } from '../utils/secureStore';
import { readString, removeKey, writeString } from '../utils/storage';
import type { SyncConfig } from './config';
import {
  SyncAuthExpiredError, SyncAuthorizationCancelledError, SyncConflictError,
  SyncPopupBlockedError,
  type RemoteSyncFile, type SyncBackend,
} from './SyncBackend';

const SYNC_PATH = '/playa-sync.json';
const OAUTH_MESSAGE = 'PLAYA_DROPBOX_OAUTH';
const OAUTH_CHANNEL = 'playa-dropbox-oauth';
const OAUTH_TIMEOUT_MS = 5 * 60_000;
// Focus commonly returns to the opener before postMessage/BroadcastChannel
// delivers the callback. Give that valid result a generous chance to win
// before interpreting a closed WindowProxy as manual cancellation.
const OAUTH_CLOSE_CALLBACK_GRACE_MS = 1_500;
// Durable same-origin handoff the popup callback writes before it closes. Lets
// the opener recover the authorization code even if postMessage and the
// BroadcastChannel are both delivered after the popup-closed grace window, so a
// successful-but-slow sign-in is never misread as a cancel. The key is scoped
// by the attempt's random `state` so two tabs connecting at once never clobber
// each other's callback; the `bm-` prefix means "Clear all local data" also
// sweeps any abandoned record.
const OAUTH_RESULT_PREFIX = 'bm-sync-oauth-result/';
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const DROPBOX_SCOPES = ['files.content.read', 'files.content.write'];
// Popup vs. redirect are distinguished by state prefix. `pcr_` deliberately
// does NOT start with `pc_`, so the pre-Preact popup relay in site.html
// (indexOf('pc_') === 0) ignores redirect callbacks and lets the app boot.
const POPUP_STATE_PREFIX = 'pc_';
const REDIRECT_STATE_PREFIX = 'pcr_';
// A standalone-PWA redirect round-trip is seconds; expire stale pending state
// so an abandoned attempt can't complete an exchange much later.
const REDIRECT_PENDING_TTL_MS = 15 * 60_000;

interface PendingRedirectAuth {
  state: string;
  verifier: string;
  redirect: string;
  at: number;
}

interface StoredSession {
  version: 2;
  accessToken?: string;
  expiresAt?: number;
  refreshToken?: string;
}

interface OAuthMessage {
  type: typeof OAUTH_MESSAGE;
  state: string;
  code?: string;
  error?: string;
}

interface DropboxTokenResult {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
}

function randomUrlSafe(bytes = 24): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (const byte of raw) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function redirectUri(): string {
  return `${location.origin}${location.pathname}`;
}

export function buildDropboxAuthorizeUrl(
  auth: DropboxAuth, redirect: string, state: string,
): Promise<string> {
  return auth.getAuthenticationUrl(
    redirect, state, 'code', 'offline', DROPBOX_SCOPES, 'none', true,
  );
}

function savePendingRedirect(pending: PendingRedirectAuth): void {
  writeString(LS.syncAuthPending, JSON.stringify(pending));
}

function loadPendingRedirect(now: number): PendingRedirectAuth | null {
  const raw = readString(LS.syncAuthPending, '');
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof v.state !== 'string' || !v.state.startsWith(REDIRECT_STATE_PREFIX)
      || typeof v.verifier !== 'string' || !v.verifier
      || typeof v.redirect !== 'string' || !v.redirect
      || typeof v.at !== 'number' || !Number.isFinite(v.at)
      || now - v.at > REDIRECT_PENDING_TTL_MS
    ) return null;
    return { state: v.state, verifier: v.verifier, redirect: v.redirect, at: v.at };
  } catch { return null; }
}

function clearPendingRedirect(): void {
  removeKey(LS.syncAuthPending);
}

/** Read `{code,state,error}` from the current URL's query (the Dropbox
 *  redirect target), without touching the hash the app uses for routing. */
function readRedirectCallback(): { state: string; code: string; error: string } | null {
  if (typeof location === 'undefined') return null;
  const params = new URLSearchParams(location.search);
  const state = params.get('state') ?? '';
  if (!state.startsWith(REDIRECT_STATE_PREFIX)) return null;
  return { state, code: params.get('code') ?? '', error: params.get('error') ?? '' };
}

/** Strip only the OAuth params from the URL, before the code exchange, so a
 *  refresh can't replay them. Preserves any app route hash and other query. */
function stripRedirectCallbackFromUrl(): void {
  if (typeof location === 'undefined' || typeof history === 'undefined') return;
  const url = new URL(location.href);
  for (const key of ['code', 'state', 'error', 'error_description']) {
    url.searchParams.delete(key);
  }
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

/** Consume the popup's durable localStorage handoff for this attempt's `state`,
 *  if present and fresh. Always clears this attempt's record so it can't be
 *  replayed. Returns the code/error, or null when nothing matches. */
function takeOAuthHandoff(state: string, now: number): { code: string; error: string } | null {
  const key = OAUTH_RESULT_PREFIX + state;
  let raw: string | null = null;
  try { raw = localStorage.getItem(key); } catch { return null; }
  if (!raw) return null;
  try { localStorage.removeItem(key); } catch { /* best effort */ }
  let value: Record<string, unknown>;
  try { value = JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
  if (value.state !== state) return null;
  if (typeof value.at !== 'number' || now - value.at > OAUTH_TIMEOUT_MS) return null;
  return {
    code: typeof value.code === 'string' ? value.code : '',
    error: typeof value.error === 'string' ? value.error : '',
  };
}

function clearOAuthHandoff(state: string): void {
  try { localStorage.removeItem(OAUTH_RESULT_PREFIX + state); } catch { /* best effort */ }
}

/** Remove only *expired* handoff records (any attempt's). Runs when a new wait
 *  starts, bounding leftover records from attempts abandoned before their
 *  popup could close — without touching a concurrent tab's still-fresh one. */
function sweepStaleOAuthHandoffs(now: number): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(OAUTH_RESULT_PREFIX)) continue;
      let at = 0;
      try { at = (JSON.parse(localStorage.getItem(key) ?? '{}') as { at?: number }).at ?? 0; } catch { at = 0; }
      if (!at || now - at > OAUTH_TIMEOUT_MS) stale.push(key);
    }
    for (const key of stale) localStorage.removeItem(key);
  } catch { /* best effort */ }
}

export function waitForOAuth(
  popup: Window,
  state: string,
  signal?: AbortSignal,
  closeCheckDelayMs = OAUTH_CLOSE_CALLBACK_GRACE_MS,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const channel = 'BroadcastChannel' in window
      ? new window.BroadcastChannel(OAUTH_CHANNEL)
      : null;
    let timeout = 0;
    let closeCheck = 0;
    let popupHadFocus = false;
    // Drop only *expired* leftovers from abandoned attempts. A concurrent tab's
    // fresh record (a different `state`) is left intact for its own wait.
    sweepStaleOAuthHandoffs(Date.now());
    const finish = (error?: Error, code?: string) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('focus', onWindowFocus);
      window.clearTimeout(timeout);
      window.clearTimeout(closeCheck);
      signal?.removeEventListener('abort', onAbort);
      clearOAuthHandoff(state);
      try { channel?.close(); } catch { /* ignore */ }
      try { popup.close(); } catch { /* ignore */ }
      if (error) reject(error);
      else resolve(code ?? '');
    };
    const accept = (data: OAuthMessage | null | undefined) => {
      if (!data || data.type !== OAUTH_MESSAGE || data.state !== state) return;
      if (data.error) finish(new Error(`Dropbox authorization failed: ${data.error}`));
      else if (data.code) finish(undefined, data.code);
    };
    const onMessage = (event: MessageEvent<OAuthMessage>) => {
      if (event.origin !== location.origin || event.source !== popup) return;
      accept(event.data);
    };
    const onWindowBlur = () => { popupHadFocus = true; };
    const onWindowFocus = () => {
      if (!popupHadFocus) return;
      window.clearTimeout(closeCheck);
      closeCheck = window.setTimeout(() => {
        // Check only after the opener lost and regained focus. Continuously
        // polling `closed` is unsafe: Dropbox/privacy-browser COOP isolation
        // can make a still-open popup's severed WindowProxy appear closed.
        if (!popup.closed) return;
        // The popup is gone. Before concluding the user cancelled, consult the
        // durable handoff: a successful sign-in whose message merely arrived
        // late still left its code here, and must resolve rather than reject.
        const handoff = takeOAuthHandoff(state, Date.now());
        if (handoff?.error) finish(new Error(`Dropbox authorization failed: ${handoff.error}`));
        else if (handoff?.code) finish(undefined, handoff.code);
        else finish(new SyncAuthorizationCancelledError());
      }, closeCheckDelayMs);
    };
    const onAbort = () => finish(new SyncAuthorizationCancelledError());
    window.addEventListener('message', onMessage);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('focus', onWindowFocus);
    if (channel) channel.onmessage = (event: MessageEvent<OAuthMessage>) => accept(event.data);
    if (signal?.aborted) {
      finish(new SyncAuthorizationCancelledError());
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    // Preserve a generous ceiling for users who need time to sign in. Manual
    // close is handled above; the UI also exposes an immediate Cancel action.
    timeout = window.setTimeout(() => finish(new Error(
      'Dropbox sign-in did not return to this tab. Close the Dropbox window and try again.',
    )), OAUTH_TIMEOUT_MS);
  });
}

function parseStoredSession(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const accessToken = typeof value.accessToken === 'string' && value.accessToken
      ? value.accessToken : undefined;
    const expiresAt = typeof value.expiresAt === 'number' && Number.isFinite(value.expiresAt)
      ? value.expiresAt : undefined;
    const refreshToken = typeof value.refreshToken === 'string' && value.refreshToken
      ? value.refreshToken : undefined;
    if (!refreshToken && (!accessToken || expiresAt === undefined)) return null;
    return { version: 2, accessToken, expiresAt, refreshToken };
  } catch { return null; }
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

function errorSummary(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const payload = (error as { error?: unknown }).error;
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return '';
  const summary = (payload as { error_summary?: unknown }).error_summary;
  return typeof summary === 'string' ? summary : '';
}

function isAuthenticationError(error: unknown): boolean {
  const status = errorStatus(error);
  return status === 400 || status === 401;
}

export class DropboxBackend implements SyncBackend {
  constructor(
    private readonly config: SyncConfig,
    // Firefox throws "fetch called on an object that does not implement
    // interface Window" when Window.fetch is handed to the Dropbox SDK as an
    // unbound function. Keep injected fetches untouched for tests, but bind
    // the browser default to its global receiver.
    private readonly fetchFn: typeof fetch = (...args) => globalThis.fetch(...args),
    private readonly clock: () => number = Date.now,
    // Top-level navigation for the redirect auth path. Injectable so tests can
    // observe the target without happy-dom attempting a real navigation.
    private readonly navigate: (url: string) => void = (url) => { location.assign(url); },
  ) {}

  private async session(): Promise<StoredSession | null> {
    return parseStoredSession(await loadSecureValue(LS.syncToken));
  }

  private createAuth(session?: StoredSession): DropboxAuth {
    return new DropboxAuth({
      clientId: this.config.clientId,
      fetch: this.fetchFn,
      ...(session?.accessToken ? { accessToken: session.accessToken } : {}),
      ...(session?.expiresAt !== undefined
        ? { accessTokenExpiresAt: new Date(session.expiresAt) } : {}),
      ...(session?.refreshToken ? { refreshToken: session.refreshToken } : {}),
    });
  }

  private async saveSession(session: StoredSession): Promise<void> {
    const stored = await cacheSecureValue(LS.syncToken, JSON.stringify(session));
    if (!stored) throw new Error('This browser cannot securely save the Dropbox session.');
  }

  private async authenticatedClient(): Promise<Dropbox> {
    const session = await this.session();
    if (!session) throw new SyncAuthExpiredError();
    if (!session.refreshToken && (
      !session.accessToken || session.expiresAt === undefined
      || session.expiresAt <= this.clock() + TOKEN_EXPIRY_SKEW_MS
    )) {
      clearSecureValue(LS.syncToken);
      throw new SyncAuthExpiredError();
    }

    const auth = this.createAuth(session);
    try {
      await auth.checkAndRefreshAccessToken();
    } catch (error) {
      if (isAuthenticationError(error)) {
        clearSecureValue(LS.syncToken);
        throw new SyncAuthExpiredError();
      }
      throw error;
    }

    const accessToken = auth.getAccessToken();
    if (!accessToken) {
      clearSecureValue(LS.syncToken);
      throw new SyncAuthExpiredError();
    }
    const expiresAt = auth.getAccessTokenExpiresAt()?.getTime();
    if (accessToken !== session.accessToken || expiresAt !== session.expiresAt) {
      await this.saveSession({
        version: 2,
        accessToken,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        ...(session.refreshToken ? { refreshToken: session.refreshToken } : {}),
      });
    }
    return new Dropbox({ auth });
  }

  async isConnected(): Promise<boolean> {
    const session = await this.session();
    if (!session) return false;
    if (session.refreshToken) return true;
    return !!session.accessToken && session.expiresAt !== undefined
      && session.expiresAt > this.clock() + TOKEN_EXPIRY_SKEW_MS;
  }

  /** Exchange an authorization code for the wrapped offline session. Shared by
   *  the popup and redirect paths; `auth` must already hold the PKCE verifier
   *  (implicitly from getAuthenticationUrl, or via setCodeVerifier). */
  private async exchangeCodeAndSave(
    auth: DropboxAuth, redirect: string, code: string,
  ): Promise<void> {
    const response = await auth.getAccessTokenFromCode(redirect, code);
    const payload = response.result as DropboxTokenResult;
    if (
      typeof payload.access_token !== 'string' || !payload.access_token
      || typeof payload.expires_in !== 'number' || !Number.isFinite(payload.expires_in)
      || typeof payload.refresh_token !== 'string' || !payload.refresh_token
    ) {
      throw new Error('Dropbox returned an invalid token response.');
    }
    await this.saveSession({
      version: 2,
      accessToken: payload.access_token,
      expiresAt: this.clock() + payload.expires_in * 1000,
      refreshToken: payload.refresh_token,
    });
  }

  async authorize(signal?: AbortSignal): Promise<void> {
    const popup = window.open('', 'playa-dropbox-oauth', 'popup,width=520,height=720');
    if (!popup) throw new SyncPopupBlockedError();
    const state = `${POPUP_STATE_PREFIX}${randomUrlSafe()}`;
    const redirect = redirectUri();
    const auth = this.createAuth();
    try {
      popup.location.href = await buildDropboxAuthorizeUrl(auth, redirect, state);
      const code = await waitForOAuth(popup, state, signal);
      await this.exchangeCodeAndSave(auth, redirect, code);
      if (signal?.aborted) {
        clearSecureValue(LS.syncToken);
        throw new SyncAuthorizationCancelledError();
      }
    } catch (error) {
      try { popup.close(); } catch { /* ignore */ }
      throw error;
    }
  }

  async beginRedirectAuth(): Promise<void> {
    const state = `${REDIRECT_STATE_PREFIX}${randomUrlSafe()}`;
    const redirect = redirectUri();
    const auth = this.createAuth();
    const url = await buildDropboxAuthorizeUrl(auth, redirect, state);
    // The full-page navigation destroys `auth`; persist the PKCE verifier so the
    // returning page can complete the exchange. Written just before leaving.
    savePendingRedirect({ state, verifier: auth.getCodeVerifier(), redirect, at: this.clock() });
    this.navigate(url);
  }

  async completeRedirectAuth(): Promise<boolean> {
    const callback = readRedirectCallback();
    if (!callback) return false;
    const pending = loadPendingRedirect(this.clock());
    if (!pending) return false;
    // Consume the pending state and clean the URL before doing anything that can
    // throw, so a denied attempt or a refresh can never replay the callback.
    clearPendingRedirect();
    stripRedirectCallbackFromUrl();
    if (callback.state !== pending.state) {
      throw new Error('Dropbox sign-in could not be verified. Please reconnect.');
    }
    if (callback.error || !callback.code) {
      throw new Error('Dropbox authorization was cancelled.');
    }
    const auth = this.createAuth();
    auth.setCodeVerifier(pending.verifier);
    await this.exchangeCodeAndSave(auth, pending.redirect, callback.code);
    return true;
  }

  async readFile(): Promise<RemoteSyncFile> {
    try {
      const response = await (await this.authenticatedClient()).filesDownload({ path: SYNC_PATH });
      const result = response.result;
      // The SDK always returns a Blob in a browser/worker (isWindowOrWorker());
      // the Node Buffer path (fileBinary) never runs in this app.
      if (!result.fileBlob) throw new Error('Dropbox did not return the backup file contents.');
      const text = await result.fileBlob.text();
      return { text, revision: result.rev };
    } catch (error) {
      if (errorStatus(error) === 401) {
        clearSecureValue(LS.syncToken);
        throw new SyncAuthExpiredError();
      }
      if (errorStatus(error) === 409 && /^path\/not_found(?:\/|$)/.test(errorSummary(error))) {
        return { text: null, revision: null };
      }
      if (errorStatus(error) === 409) {
        throw new Error('Dropbox could not read the backup file (409).');
      }
      throw error;
    }
  }

  async writeFile(text: string, revision: string | null): Promise<string> {
    try {
      const response = await (await this.authenticatedClient()).filesUpload({
        path: SYNC_PATH,
        mode: revision ? { '.tag': 'update', update: revision } : { '.tag': 'add' },
        autorename: false,
        mute: true,
        strict_conflict: true,
        contents: text,
      });
      return response.result.rev;
    } catch (error) {
      if (errorStatus(error) === 401) {
        clearSecureValue(LS.syncToken);
        throw new SyncAuthExpiredError();
      }
      if (errorStatus(error) === 409) throw new SyncConflictError();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    // Capture the session for best-effort server revocation, but remove the
    // browser credential synchronously. Callers such as Cancel can therefore
    // permit an immediate retry without an authorized-but-disconnected gap.
    const sessionPromise = this.session();
    clearSecureValue(LS.syncToken);
    const session = await sessionPromise;
    if (!session) return;
    try {
      await new Dropbox({ auth: this.createAuth(session) }).authTokenRevoke();
    } catch { /* local disconnect still succeeds offline or after revocation */ }
  }
}
