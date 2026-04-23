// About & disclaimer modal. Static content plus one destructive
// action: "Clear all local data" wipes every bm-* storage key and
// reloads the page.
import { useEffect, useRef } from 'preact/hooks';
import { LS, SS } from '../types';
import { removeKey } from '../utils/storage';

interface Props {
  open: boolean;
  scrapedDate: string;
  contactEmail: string;
  onClose: () => void;
}

export function InfoModal({ open, scrapedDate, contactEmail, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (open) closeRef.current?.focus(); }, [open]);

  function handleBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleClearAll() {
    const msg = [
      'Clear all local data?',
      '',
      'This removes:',
      "  • your favorited camps and events",
      "  • your theme preference",
      "  • the password cached for this tab",
      '',
      "You'll need to re-enter the password.",
    ].join('\n');
    if (!confirm(msg)) return;
    removeKey(LS.favs);
    removeKey(LS.favEvents);
    removeKey(LS.theme);
    removeKey(LS.infoSeen);
    try { sessionStorage.removeItem(SS.password); } catch {}
    location.reload();
  }

  const takedownHref =
    `mailto:${contactEmail}` +
    '?subject=%5BBM%20Camps%5D%20Takedown%20request' +
    '&body=Camp%20name%3A%20%0ACamp%20URL%20on%20directory.burningman.org%3A%20%0A%0A' +
    'Please%20remove%20my%20camp%20from%20this%20site.%20Thanks.';

  return (
    <div
      class={'modal' + (open ? '' : ' modal-hidden')}
      role="dialog"
      aria-modal="true"
      aria-labelledby="info-title"
      onClick={handleBackdrop}
    >
      <div class="modal-card">
        <div class="modal-head">
          <h2 id="info-title">About this site</h2>
          <button
            ref={closeRef}
            class="modal-close"
            type="button"
            aria-label="Close"
            onClick={onClose}
          >✕</button>
        </div>
        <div class="modal-body">
          <p>
            <span class="warn">⚠ Unofficial &amp; best-effort</span>
            <span class="badge">Built for Burners, not commercial</span>
          </p>
          <p>
            This is an unofficial personal project to help friends browse and
            filter the{' '}
            <a href="https://directory.burningman.org/camps/" target="_blank" rel="noopener">
              official Burning Man Playa Info directory
            </a>. All camp names, descriptions, events, and locations are the
            property of their respective camps and the directory operators.
          </p>
          <p>
            <strong>Provided as is.</strong> Camp details here can be stale,
            incomplete, mis-parsed, or mis-tagged.{' '}
            <strong>
              Always verify on{' '}
              <a href="https://directory.burningman.org/camps/" target="_blank" rel="noopener">
                directory.burningman.org
              </a>
            </strong>{' '}
            before acting on anything you see here. Use this tool to{' '}
            <em>narrow down</em> a shortlist of possible camps — not as the
            source of truth.
          </p>
          <p>
            <strong>What you can trust less:</strong> the auto-generated tags
            (keyword matching, not curated), event times, and anything that
            changed on the directory after the last nightly refresh.
          </p>
          <p>
            Data is scraped nightly from the public directory and shown here
            for personal browsing only. For the canonical, up-to-date
            listing, please use{' '}
            <a href="https://directory.burningman.org/camps/" target="_blank" rel="noopener">
              directory.burningman.org
            </a>. This site has{' '}
            <strong>
              no ads, no analytics, no tracking, no accounts, and no commercial
              purpose
            </strong>.
          </p>
          <p>
            <strong>Camp owner? Want your camp removed?</strong>{' '}
            <a href={takedownHref}>Email a takedown request</a> — please
            include the camp name and directory URL, and the entry will be
            removed on the next build.
          </p>
          <p>
            <strong>Found a bug or a mis-parse?</strong>{' '}
            <a href="https://github.com/shreyaspurohit/playa/issues" target="_blank" rel="noopener">
              Open an issue on GitHub
            </a>{' '}— include the camp name and what looks wrong.
          </p>
          <p>
            <strong>Stored on this device:</strong> theme, password (per tab),
            and the camps and events you've starred. Nothing leaves your
            browser.{' '}
            <button class="danger-btn" type="button" onClick={handleClearAll}>
              Clear all local data
            </button>
          </p>
          <p class="footnote">
            No affiliation with Black Rock City, LLC or the Burning Man
            Project. Updated {scrapedDate}.
          </p>
        </div>
      </div>
    </div>
  );
}
