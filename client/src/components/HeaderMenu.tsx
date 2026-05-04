// Hamburger-style dropdown that consolidates the header's secondary
// actions: source switcher, about/disclaimer, report bug, install
// prompt, and theme picker. Lets the topline stay compact (just
// title + nickname + this trigger), which matters most on mobile
// where 5+ inline buttons stretched the row past the viewport.
//
// Behavior:
//  - Click trigger to toggle open/closed.
//  - Click outside or press Escape → close.
//  - The menu is positioned below the trigger via CSS.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Source } from '../types';
import { THEMES } from '../hooks/useTheme';
import { InstallPrompt } from './InstallPrompt';
import { SourceSwitcher } from './SourceSwitcher';

interface Props {
  source: Source;
  availableSources: Source[];
  onSourceChange: (s: Source) => void;
  currentTheme: string;
  onThemeChange: (name: string) => void;
  onInfoClick: () => void;
  infoPulse: boolean;
}

export function HeaderMenu({
  source, availableSources, onSourceChange,
  currentTheme, onThemeChange, onInfoClick, infoPulse,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function close() { setOpen(false); }
  // Wrap an action so the menu auto-closes after the user picks it.
  // The InfoModal opens after this fires; closing the menu first keeps
  // focus management simple.
  function pick<T extends (...args: never[]) => void>(fn: T) {
    return (...args: Parameters<T>) => { fn(...args); close(); };
  }

  return (
    <div class="header-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        class={'header-menu-trigger' + (open ? ' open' : '') + (infoPulse ? ' pulse' : '')}
        aria-label="Menu"
        aria-haspopup="true"
        aria-expanded={open ? 'true' : 'false'}
        onClick={() => setOpen((v) => !v)}
      >
        {/* Three horizontal lines — universally recognized as menu */}
        <span class="header-menu-icon" aria-hidden="true">
          <span /><span /><span />
        </span>
      </button>
      {open && (
        <div class="header-menu-panel" role="menu">
          {/* Source switcher — kept full-width inside the menu so the
              dropdown native control isn't fighting for space. */}
          {availableSources.length > 1 && (
            <div class="header-menu-section">
              <div class="header-menu-label">Data source</div>
              <SourceSwitcher
                source={source}
                available={availableSources}
                onChange={(s) => { onSourceChange(s); close(); }}
              />
            </div>
          )}

          {/* Theme picker — five buttons in a row inside the menu. */}
          <div class="header-menu-section">
            <div class="header-menu-label">Theme</div>
            <div class="themes" role="group" aria-label="Theme">
              {THEMES.map(([name, icon, label]) => (
                <button
                  key={name}
                  class={'theme-btn' + (currentTheme === name ? ' active' : '')}
                  type="button"
                  data-theme={name}
                  title={label}
                  aria-label={`${label} theme`}
                  aria-pressed={currentTheme === name ? 'true' : 'false'}
                  onClick={() => onThemeChange(name)}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>

          {/* Action items. Each closes the menu on click. */}
          <div class="header-menu-section header-menu-actions">
            <button
              type="button"
              class="header-menu-item"
              role="menuitem"
              onClick={pick(onInfoClick)}
            >
              <span aria-hidden="true">ⓘ</span>
              <span>About &amp; disclaimer</span>
            </button>
            <a
              class="header-menu-item"
              role="menuitem"
              href="https://github.com/shreyaspurohit/playa/issues"
              target="_blank"
              rel="noopener"
              onClick={close}
            >
              <span aria-hidden="true">🐛</span>
              <span>Report bug</span>
            </a>
          </div>

          {/* PWA install / offline-ready chip — only renders when
              the platform supports/requires it. Inline so the
              "Install app" affordance doesn't disappear behind an
              extra layer; close on click since it'll prompt the
              native install dialog anyway. */}
          <div class="header-menu-section header-menu-install">
            <InstallPrompt />
          </div>
        </div>
      )}
    </div>
  );
}
