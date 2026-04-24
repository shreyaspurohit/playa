// Tiny hash-based router. The URL carries the current tab in its
// fragment (e.g. "#schedule", "#map", "#camps"). Fragments are the
// natural home for client-side routing on a static site — they never
// hit the server.
//
// Note: the share URL *also* uses the fragment (#share=…). We ignore
// those here — when a share is present we treat the view as 'camps'
// (the default) and let the import banner handle it on top.
import { useCallback, useEffect, useState } from 'preact/hooks';

const VALID = new Set(['camps', 'schedule', 'map']);
export type View = 'camps' | 'schedule' | 'map';

function currentView(): View {
  const frag = location.hash.slice(1);
  // Drop anything after the first '&' (e.g. share=… is kept but ignored here).
  const primary = frag.split('&')[0];
  return (VALID.has(primary) ? primary : 'camps') as View;
}

export function useHashRoute() {
  const [view, setView] = useState<View>(currentView);

  useEffect(() => {
    const onChange = () => setView(currentView());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const goto = useCallback((v: View) => {
    // Preserve any other fragment params (like share=…). Replace the
    // primary view segment with the new view; drop empty chunks so an
    // empty hash doesn't produce a trailing '&'.
    const frag = location.hash.slice(1);
    const others = frag.split('&').filter((p) => p && !VALID.has(p.split('=')[0]));
    const next = [v, ...others].join('&');
    location.hash = '#' + next;
  }, []);

  return { view, goto };
}
