// Top of page: title, version pill, PWA install + offline-ready
// indicators, report bug link, info button, theme switcher. Keyed
// to the version + fetch metadata the Python builder injected as
// <meta name="bm-*"> tags.
import type { Source } from '../types';
import { THEMES } from '../hooks/useTheme';
import { InstallPrompt } from './InstallPrompt';
import { NicknamePill } from './NicknamePill';
import { SourceSwitcher } from './SourceSwitcher';

interface Props {
  total: number;
  matching: number;
  filterNote: string;
  fetchedDate: string;
  fetchedAt: string;
  version: string;
  currentTheme: string;
  onThemeChange: (name: string) => void;
  onInfoClick: () => void;
  infoPulse: boolean;
  source: Source;
  availableSources: Source[];
  onSourceChange: (s: Source) => void;
}

export function Header({
  total, matching, filterNote, fetchedDate, fetchedAt, version,
  currentTheme, onThemeChange, onInfoClick, infoPulse,
  source, availableSources, onSourceChange,
}: Props) {
  return (
    <header>
      <div class="topline">
        <div class="titleblock">
          <h1>Playa Camps</h1>
          <span
            class="version"
            title={`Directory last fetched ${fetchedAt} UTC`}
          >
            Updated {fetchedDate} · {version}
          </span>
        </div>
        <div class="topline-right">
          <SourceSwitcher
            source={source}
            available={availableSources}
            onChange={onSourceChange}
          />
          <NicknamePill />
          <InstallPrompt />
          <a
            class="report-link"
            href="https://github.com/shreyaspurohit/playa/issues"
            target="_blank"
            rel="noopener"
            title="Report a bug on GitHub"
          >
            🐛 Report bug
          </a>
          <button
            class={'info-btn' + (infoPulse ? ' pulse' : '')}
            type="button"
            aria-label="About and disclaimer"
            title="About & disclaimer"
            onClick={onInfoClick}
          >
            i
          </button>
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
      </div>
      <div class="stats">
        <span>{total.toLocaleString()}</span> camps ·{' '}
        <span>{matching.toLocaleString()}</span> matching
        {filterNote && <span>{filterNote}</span>}
      </div>
    </header>
  );
}
