interface Props {
  fetchedDate: string;
}

export function Footer({ fetchedDate }: Props) {
  return (
    <footer class="site-footer">
      <div class="col">
        <p><span class="badge">Built for Burners, not commercial</span></p>
        <p>
          This app uses an official API snapshot that may be stale or incomplete.
          Check critical details against current official Burning Man communications.
        </p>
        <p style={{ opacity: 0.7 }}>
          This app is not affiliated, endorsed, or verified by Burning Man
          Project. Updated {fetchedDate}.{' '}
          <a href="./privacy.html">Privacy Policy</a>.
        </p>
      </div>
    </footer>
  );
}
