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
  return { theme, setTheme: setThemeState };
}
