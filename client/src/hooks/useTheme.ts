// Theme management: read saved theme on init, persist on change, keep
// <html data-theme="..."> in sync. Brightest → darkest order.
import { useEffect, useState } from 'preact/hooks';
import { LS } from '../types';
import { readString, writeString } from '../utils/storage';

export const THEMES: ReadonlyArray<readonly [name: string, icon: string, label: string]> = [
  ['paper',    '☀️', 'Paper'],     // sun
  ['daylight', '⛅',       'Daylight'],  // sun behind cloud
  ['dusk',     '🌇', 'Dusk'],      // sunset over buildings
  ['night',    '🌙', 'Night'],     // crescent moon
  ['eclipse',  '🌑', 'Eclipse'],   // new moon
];

const THEME_NAMES = new Set(THEMES.map((t) => t[0]));

function initialTheme(): string {
  const t = readString(LS.theme, 'paper');
  return THEME_NAMES.has(t) ? t : 'paper';
}

export function useTheme() {
  const [theme, setThemeState] = useState<string>(initialTheme);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    writeString(LS.theme, theme);
  }, [theme]);
  // Multi-tab sync — picking a theme in tab A propagates to tab B.
  useEffect(() => {
    const win = typeof window !== 'undefined' ? window : null;
    if (!win) return;
    function onStorage(e: StorageEvent) {
      if (e.key !== null && e.key !== LS.theme) return;
      const next = readString(LS.theme, 'paper');
      if (THEME_NAMES.has(next)) setThemeState(next);
    }
    win.addEventListener('storage', onStorage);
    return () => win.removeEventListener('storage', onStorage);
  }, []);
  return { theme, setTheme: setThemeState };
}
