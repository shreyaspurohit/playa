// Bottom-of-page attribution + disclaimer + takedown link.

interface Props {
  fetchedDate: string;
  contactEmail: string;
}

export function Footer({ fetchedDate, contactEmail }: Props) {
  const takedown =
    `mailto:${contactEmail}` +
    '?subject=%5BBM%20Camps%5D%20Takedown%20request' +
    '&body=Camp%20name%3A%20%0ACamp%20URL%20on%20directory.burningman.org%3A%20%0A%0A' +
    'Please%20remove%20my%20camp%20from%20this%20site.%20Thanks.';
  return (
    <footer class="site-footer">
      <div class="col">
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
          </a>. This site has no ads, no analytics, no tracking, and no
          commercial purpose.
        </p>
        <p>
          <strong>Camp owner? Want your camp removed?</strong>{' '}
          <a href={takedown}>Email a takedown request</a> — please include
          the camp name and directory URL, and the entry will be removed on
          the next build.
        </p>
        <p style={{ opacity: 0.7 }}>
          This app is not affiliated, endorsed, or verified by Burning Man
          Project. Updated {fetchedDate}.
        </p>
      </div>
    </footer>
  );
}
