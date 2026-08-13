// Bottom-of-page attribution + disclaimer. Directory-specific copy and
// the takedown link appear only while that source is selected; the API
// terms' required no-affiliation notice is always present.
import type { Source } from '../types';

interface Props {
  fetchedDate: string;
  contactEmail: string;
  source: Source;
}

export function Footer({ fetchedDate, contactEmail, source }: Props) {
  const takedown =
    `mailto:${contactEmail}` +
    '?subject=%5BBM%20Camps%5D%20Takedown%20request' +
    '&body=Camp%20name%3A%20%0ACamp%20URL%20on%20directory.burningman.org%3A%20%0A%0A' +
    'Please%20remove%20my%20camp%20from%20this%20site.%20Thanks.';
  return (
    <footer class="site-footer">
      <div class="col">
        {source === 'directory' && (
          <>
            <p>
              <span class="badge">Built for Burners, not commercial</span>
              This is an unofficial personal project to help friends browse and
              filter the{' '}
              <a href="https://directory.burningman.org/camps/" target="_blank" rel="noopener">
                official Burning Man Playa Info directory
              </a>. All camp names, descriptions, events, and locations are the
              property of their respective camps and the directory operators.
            </p>
            <p>
              Data is fetched nightly from the public directory and shown here
              for personal browsing only. For the canonical, up-to-date listing,
              please use{' '}
              <a href="https://directory.burningman.org/camps/" target="_blank" rel="noopener">
                directory.burningman.org
              </a>. The app has no ads and sets no cookies or tracking scripts
              of its own. Cloudflare and GitHub Pages, which serve it, process
              ordinary request metadata (such as IP addresses) and expose
              aggregate traffic statistics.
            </p>
            <p>
              <strong>Camp owner? Want your camp removed?</strong>{' '}
              <a href={takedown}>Email a takedown request</a> — please include
              the camp name and directory URL, and the entry will be removed on
              the next build.
            </p>
          </>
        )}
        <p style={{ opacity: 0.7 }}>
          This app is not affiliated, endorsed, or verified by Burning Man
          Project. Updated {fetchedDate}.{' '}
          <a href="./privacy.html">Privacy Policy</a>.
        </p>
      </div>
    </footer>
  );
}
