// Header pill showing the currently-active data source. A native
// <select> drops down a list of every source embedded in this build
// (read from <meta name="bm-sources">). Switching is instant since
// every source's payload is already in the page — see
// docs/15-data-sources.md.
//
// Hidden when there's only one source (the default-and-only build),
// so directory-only deploys keep their existing chrome.
import type { JSX } from 'preact';
import type { Source } from '../types';

function labelFor(source: Source): string {
  if (source === 'directory') return 'Directory';
  if (source.startsWith('api-')) return `API ${source.slice(4)}`;
  return source;
}

export function SourceSwitcher({
  source, available, onChange,
}: {
  source: Source;
  available: Source[];
  onChange: (next: Source) => void;
}): JSX.Element | null {
  if (available.length <= 1) return null;
  return (
    <label class="source-switcher" title="Switch data source">
      <span class="source-switcher-label">Source:</span>
      <select
        class="source-switcher-select"
        value={source}
        onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
      >
        {available.map((s) => (
          <option key={s} value={s}>{labelFor(s)}</option>
        ))}
      </select>
    </label>
  );
}
