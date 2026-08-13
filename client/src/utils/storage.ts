// Safe localStorage wrappers. Safari Private Mode throws on setItem
// beyond quota; we silently no-op.

export const LOCAL_STORAGE_CHANGE_EVENT = 'playa-local-storage-change';

function notifyChange(key: string): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(LOCAL_STORAGE_CHANGE_EVENT, { detail: { key } }));
  } catch { /* non-DOM test/runtime */ }
}

export function readStringSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.map(String));
  } catch {
    /* bad JSON or storage unavailable */
  }
  return new Set();
}

export function writeStringSet(key: string, set: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
    notifyChange(key);
  } catch {
    /* storage unavailable */
  }
}

export function readString(key: string, fallback = ''): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    notifyChange(key);
  } catch {
    /* storage unavailable */
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
    notifyChange(key);
  } catch {
    /* storage unavailable */
  }
}
