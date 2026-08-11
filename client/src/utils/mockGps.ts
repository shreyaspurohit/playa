// Dev/testing-only simulated GPS. Add `?gps=<lat>,<lng>` before the hash:
//   /?gps=40.786958,-119.202994#food
// The fixed position persists in localStorage across navigation/reload and is
// consumed by useGeolocation instead of the browser's real geolocation API.
import { LS } from '../types';
import { readString, removeKey, writeString } from './storage';

export interface MockGpsPosition {
  lat: number;
  lng: number;
  accuracyM: number;
}

const MOCK_ACCURACY_M = 5;

function readGpsParam(): string | null {
  if (typeof location === 'undefined') return null;
  const match = /[?#&]gps=([^&#]+)/.exec(location.href);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

export function parseMockGps(value: string): MockGpsPosition | null {
  const parts = value.split(',').map((part) => part.trim());
  if (parts.length !== 2 || parts.some((part) => part === '')) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng, accuracyM: MOCK_ACCURACY_M };
}

/** Active simulated position, or null when real browser GPS should be used. */
export function mockGps(): MockGpsPosition | null {
  const fromUrl = readGpsParam();
  if (fromUrl) {
    const parsed = parseMockGps(fromUrl);
    if (parsed) {
      writeString(LS.mockGps, `${parsed.lat},${parsed.lng}`);
      return parsed;
    }
  }
  return parseMockGps(readString(LS.mockGps, ''));
}

export function isMockGps(): boolean {
  return mockGps() !== null;
}

export function mockGpsLabel(): string {
  const position = mockGps();
  return position ? `${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}` : '';
}

/** Remove the persisted/query override; the next request uses real GPS. */
export function clearMockGps(): void {
  removeKey(LS.mockGps);
  if (typeof location === 'undefined' || typeof history === 'undefined') return;

  const url = new URL(location.href);
  url.searchParams.delete('gps');
  let hash = url.hash.slice(1);
  hash = hash
    .replace(/(^|[?&])gps=[^&]*/g, '')
    .replace(/^[?&]+|[?&]+$/g, '')
    .replace(/\?&/g, '?');
  url.hash = hash;
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
