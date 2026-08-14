// A floating "back to top" button. Appears once the page is scrolled well down
// (camps / art are long lists) and jumps straight to the top on tap.
import { useEffect, useState } from 'preact/hooks';

const SHOW_AFTER_PX = 700;

export function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > SHOW_AFTER_PX);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!visible) return null;
  return (
    <button
      type="button"
      class="scroll-top-btn"
      title="Back to top"
      aria-label="Scroll to top"
      onClick={() => window.scrollTo({ top: 0, behavior: 'auto' })}
    >
      ↑
    </button>
  );
}
