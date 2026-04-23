// Top of page: title, version pill, report bug link, info button,
// theme switcher. Keyed to the version + scrape metadata the Python
// builder injected as <meta name="bm-*"> tags.
import { THEMES } from '../hooks/useTheme';

interface Props {
  total: number;
  matching: number;
  filterNote: string;
  scrapedDate: string;
  scrapedAt: string;
  version: string;
  currentTheme: string;
  onThemeChange: (name: string) => void;
  onInfoClick: () => void;
  infoPulse: boolean;
}

export function Header({
  total, matching, filterNote, scrapedDate, scrapedAt, version,
  currentTheme, onThemeChange, onInfoClick, infoPulse,
}: Props) {
  return (
    <header>
      <div class="topline">
        <h1>Burning Man Camps</h1>
        <div class="topline-right">
          <span
            class="version"
            title={`Directory last scraped ${scrapedAt} UTC`}
          >
            Updated {scrapedDate} · {version}
          </span>
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
