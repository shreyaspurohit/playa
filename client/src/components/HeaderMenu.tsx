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

/** Inline SVG glyph for a menu row. Stroked, currentColor — picks up
 *  the row's text color so it follows themes for free. Sized 16x16 to
 *  match the row's font-size visual weight. */
function MenuIcon({ name }: { name: 'info' | 'bug' | 'cloud-check' | 'refresh' }) {
  const common = {
    width: 16, height: 16, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor', 'stroke-width': 2,
    'stroke-linecap': 'round' as const, 'stroke-linejoin': 'round' as const,
    'aria-hidden': 'true' as const,
    class: 'header-menu-icon-svg',
  };
  if (name === 'info') {
    return (
      <svg {...common}>
        <circle cx={12} cy={12} r={9} />
        <line x1={12} y1={11} x2={12} y2={17} />
        <circle cx={12} cy={7.5} r={0.5} fill="currentColor" />
      </svg>
    );
  }
  if (name === 'bug') {
    return (
      <svg {...common}>
        {/* Body — rounded capsule. */}
        <rect x={7} y={8} width={10} height={12} rx={5} />
        {/* Antennae. */}
        <path d="M9 8 L7 4" />
        <path d="M15 8 L17 4" />
        {/* Legs — three on each side. */}
        <path d="M7 12 L4 11" />
        <path d="M7 15 L4 15" />
        <path d="M7 18 L4 19" />
        <path d="M17 12 L20 11" />
        <path d="M17 15 L20 15" />
        <path d="M17 18 L20 19" />
      </svg>
    );
  }
  if (name === 'cloud-check') {
    return (
      <svg {...common}>
        <path d="M7 18a4 4 0 0 1 -.5 -7.97A6 6 0 0 1 18 9.5a3.5 3.5 0 0 1 -1 6.85" />
        <path d="M9 14l2 2 4 -4" />
      </svg>
    );
  }
  // refresh
  return (
    <svg {...common}>
      <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

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

          {/* Action items. Each closes the menu on click. SVG icons
              (not emoji) keep the column visually consistent across
              platforms — Apple's 🐛 in particular renders as a cute
              caterpillar that doesn't read as "report bug". */}
          <div class="header-menu-section header-menu-actions">
            <button
              type="button"
              class="header-menu-item"
              role="menuitem"
              onClick={pick(onInfoClick)}
            >
              <MenuIcon name="info" />
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
              <MenuIcon name="bug" />
              <span>Report bug</span>
            </a>
          </div>

          {/* Status + install row. The InstallPrompt renders its own
              menu rows (offline status, update check, install button)
              so they line up with the action items above instead of
              looking like loose chips. */}
          <div class="header-menu-section header-menu-install">
            <InstallPrompt />
          </div>
        </div>
      )}
    </div>
  );
}
