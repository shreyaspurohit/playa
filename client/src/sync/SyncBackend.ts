export interface RemoteSyncFile {
  text: string | null;
  revision: string | null;
}

export interface SyncBackend {
  isConnected(): Promise<boolean>;
  /** Popup authorization (browser tab / desktop / Android PWA). Throws
   *  SyncPopupBlockedError when the popup cannot open. */
  authorize(signal?: AbortSignal): Promise<void>;
  /** Standalone-PWA path (ADR 16 D13): persist PKCE state and navigate the
   *  top window to Dropbox. The page unloads, so this does not resolve
   *  meaningfully on success. */
  beginRedirectAuth(): Promise<void>;
  /** On boot, complete a pending redirect authorization if the current URL is
   *  its callback. Returns true when it connected, false when nothing was
   *  pending. Throws on a failed/denied authorization (after clearing state). */
  completeRedirectAuth(): Promise<boolean>;
  readFile(): Promise<RemoteSyncFile>;
  writeFile(text: string, revision: string | null): Promise<string>;
  disconnect(): Promise<void>;
}

export class SyncAuthExpiredError extends Error {
  constructor() { super('Dropbox access is no longer authorized. Reconnect to continue syncing.'); }
}

export class SyncConflictError extends Error {
  constructor() { super('The Dropbox sync file changed during upload.'); }
}

/** window.open returned null — popups are blocked. Callers fall back to the
 *  redirect flow (ADR 16 D13) rather than surfacing a dead end. */
export class SyncPopupBlockedError extends Error {
  constructor() { super('Dropbox sign-in popup was blocked.'); }
}

/** The user closed or explicitly cancelled the popup flow. This is a normal
 *  disconnected state, not a provider/network failure. */
export class SyncAuthorizationCancelledError extends Error {
  constructor() { super('Dropbox sign-in was cancelled. You can try again.'); }
}
