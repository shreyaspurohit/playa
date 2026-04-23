// Test helper: boots a happy-dom window and wires its document, window,
// localStorage, sessionStorage etc. as globals so Preact render + our
// code can run unchanged in Node. Every test file that touches the DOM
// calls `installDom()` in a beforeEach.
import { Window } from 'happy-dom';

let currentWindow: Window | null = null;

// Keys we install as globals. Preact's render path touches `document`
// and `requestAnimationFrame`; our code also uses `localStorage`,
// `sessionStorage`, `crypto`, `TextEncoder`, `TextDecoder`, and
// `HTMLElement` (for instanceof checks).
const GLOBAL_KEYS = [
  'document',
  'window',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLButtonElement',
  'HTMLAnchorElement',
  'Element',
  'Node',
  'Event',
  'InputEvent',
  'MouseEvent',
  'KeyboardEvent',
  'SubmitEvent',
  'CustomEvent',
  'Node',
  'Text',
  'localStorage',
  'sessionStorage',
  'location',
  'navigator',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
  'atob',
  'btoa',
];

export function installDom(): Window {
  const win = new Window({ url: 'http://localhost/' });
  currentWindow = win;
  for (const key of GLOBAL_KEYS) {
    const v = (win as unknown as Record<string, unknown>)[key];
    if (v === undefined) continue;
    try {
      // Some globals (e.g. `navigator`) are readonly getters in Node 22+;
      // skip those silently — happy-dom's own navigator works via window.
      (globalThis as unknown as Record<string, unknown>)[key] = v;
    } catch {
      /* readonly — skip */
    }
  }
  return win;
}

export function teardownDom(): void {
  if (currentWindow) {
    try { currentWindow.happyDOM.close(); } catch { /* ignore */ }
  }
  for (const key of GLOBAL_KEYS) {
    try { delete (globalThis as unknown as Record<string, unknown>)[key]; }
    catch { /* readonly — skip */ }
  }
  currentWindow = null;
}
