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
import type { SyncStatus } from '../hooks/useSync';
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

/** Official Dropbox glyph, used only to identify the Dropbox integration.
 *  This is the unmodified approved brand mark (the exact box geometry Dropbox
 *  publishes at brand.dropbox.com) in the official Dropbox Blue (#0061FF) on a
 *  0 0 24 24 viewBox — no recolor to the app theme, no distortion. The adjacent
 *  text names the exact function so this cannot read as the Playa Camps logo or
 *  as a Dropbox endorsement, per the Dropbox developer branding guide. */
function DropboxGlyph() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      aria-hidden="true"
      class="header-menu-dropbox-glyph"
    >
      <path
        fill="#0061ff"
        d="M6 1.807L0 5.629l6 3.822 6.001-3.822L6 1.807zM18 1.807l-6 3.822 6 3.822 6-3.822-6-3.822zM0 13.274l6 3.822 6.001-3.822L6 9.452l-6 3.822zM18 9.452l-6 3.822 6 3.822 6-3.822-6-3.822zM6 18.371l6.001 3.822 6-3.822-6-3.822L6 18.371z"
      />
    </svg>
  );
}

function syncDetail(connected: boolean, status: SyncStatus): string {
  if (status === 'checking') return 'Checking saved connection…';
  if (status === 'connecting') return 'Opening Dropbox… tap to cancel';
  if (status === 'syncing') return 'Syncing devices, browsers & tabs…';
  if (status === 'offline') return 'Offline · local changes are safe';
  if (status === 'expired') return 'Reconnect required';
  if (status === 'error') return 'Check sync status';
  if (connected) return 'Connected · tap to sync now';
  return 'Back up, restore & keep plans aligned';
}

interface Props {
  source: Source;
  availableSources: Source[];
  onSourceChange: (s: Source) => void;
  currentTheme: string;
  onThemeChange: (name: string) => void;
  onInfoClick: () => void;
  onSyncNow: () => void;
  onSyncConnect: () => void;
  onSyncCancel: () => void;
  onSyncDisconnect: () => void;
  infoPulse: boolean;
  syncAvailable: boolean;
  syncConnected: boolean;
  syncStatus: SyncStatus;
}

export function HeaderMenu({
  source, availableSources, onSourceChange,
  currentTheme, onThemeChange, onInfoClick, onSyncNow, infoPulse,
  onSyncConnect, onSyncCancel, onSyncDisconnect,
  syncAvailable, syncConnected, syncStatus,
}: Props) {
  const [open, setOpen] = useState(false);
  const [syncDisclosureOpen, setSyncDisclosureOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const mobilePanelTop = open && typeof window !== 'undefined'
    && window.matchMedia('(max-width: 600px)').matches
    ? `${(wrapRef.current?.getBoundingClientRect().bottom ?? 0) + 8}px`
    : undefined;
  const syncBusy = syncStatus === 'checking' || syncStatus === 'syncing';

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
        <div
          class="header-menu-panel"
          role="menu"
          style={mobilePanelTop ? { top: mobilePanelTop } : undefined}
        >
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
            {syncAvailable && (
              <button
                type="button"
                class="header-menu-item header-menu-sync"
                role="menuitem"
                disabled={syncBusy}
                aria-label={syncStatus === 'connecting'
                  ? 'Cancel Dropbox sign-in'
                  : syncConnected
                    ? 'Sync now with Dropbox'
                    : 'Open Dropbox sync settings'}
                onClick={() => {
                  if (syncStatus === 'connecting') {
                    onSyncCancel();
                    setSyncDisclosureOpen(true);
                  } else if (syncConnected) onSyncNow();
                  else {
                    setSyncDisclosureOpen((value) => !value);
                  }
                }}
              >
                <DropboxGlyph />
                <span class="header-menu-item-copy">
                  <span>Dropbox sync</span>
                  <span class="header-menu-item-detail">
                    {syncDetail(syncConnected, syncStatus)}
                  </span>
                </span>
              </button>
            )}
            {syncAvailable && !syncConnected && syncDisclosureOpen && (
              <div class="header-menu-sync-note" role="status">
                <div>
                  Dropbox access is limited to this app’s private folder:
                  <strong> Apps → Playa Camps Sync</strong>. Other Dropbox
                  files are not accessible.
                </div>
                <div class="header-menu-sync-note-actions">
                  <button
                    type="button"
                    class="header-menu-sync-note-continue"
                    disabled={syncBusy}
                    onClick={() => { onSyncConnect(); close(); }}
                  >Continue to Dropbox</button>
                  <button
                    type="button"
                    class="header-menu-sync-note-cancel"
                    onClick={() => setSyncDisclosureOpen(false)}
                  >Cancel</button>
                </div>
              </div>
            )}
            {syncAvailable && syncConnected && (
              <button
                type="button"
                class="header-menu-item header-menu-sync-disconnect"
                role="menuitem"
                disabled={syncBusy}
                onClick={() => { onSyncDisconnect(); close(); }}
              >
                <MenuIcon name="cloud-check" />
                <span>Disconnect Dropbox</span>
              </button>
            )}
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
