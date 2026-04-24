// Browser Geolocation wrapper. Stays opt-in: no permission prompt until
// the caller invokes `request()`. Watches for updates after the first
// fix so the "you are here" dot tracks movement.
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

export type GeoState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'denied' | 'unavailable' | 'error'; message: string }
  | { status: 'ready'; lat: number; lng: number; accuracyM: number; at: number };

export function useGeolocation() {
  const [state, setState] = useState<GeoState>({ status: 'idle' });
  const watchId = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    // Flip UI back to idle so "Use my GPS" reappears.
    setState({ status: 'idle' });
  }, []);

  const request = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState({ status: 'unavailable', message: 'This browser has no GPS support.' });
      return;
    }
    setState({ status: 'requesting' });
    // Clear any prior watch without touching state — we're about to set it.
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        setState({
          status: 'ready',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
          at: pos.timestamp,
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setState({ status: 'denied', message: 'Location permission denied.' });
        } else {
          setState({
            status: 'error',
            message: err.message || 'Could not read location.',
          });
        }
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
  }, []);

  // Unmount cleanup: clear the watch directly. Don't call stop() — that
  // would setState on an unmounting component.
  useEffect(() => {
    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
    };
  }, []);

  return { state, request, stop };
}
