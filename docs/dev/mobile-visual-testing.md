# Mobile Visual Testing

The supported review viewport is 390×844. Use the checked-in helper so temporary
plaintext API data and the encrypted build are handled consistently.

## Automated capture

1. Ensure `data/api/2026.json` (or the configured current-year cache) exists.
2. Set the build dates and `BM_API_YEARS` in `.env`.
3. Provide `CHROME_HEADLESS_SHELL` or install it under
   `chrome-headless-shell/`.
4. Run:

   ```bash
   make review-mobile
   ```

The script builds an API-only plaintext review artifact, captures tab/menu
states into a unique `/tmp/playa-mobile-review.*` folder, then restores the
normal encrypted build and verifies `bm-brc-map-year` plus its GIS payload.
Review screenshots locally and delete only the exact printed temporary folder;
it contains private Event Data.

## Manual review matrix

- Locked gate, wrong password, normal unlock, and spirit auto-unlock.
- Camps, Art, Food, Schedule, Map, Journal, Ask, About, Export, Import, and
  optional Dropbox surfaces.
- Header collapse/restore on long pages and stable controls on short pages.
- Current-year location masking for normal tiers and trusted internal reveal.
- Source switching across every configured annual API snapshot.
- Offline reload after first successful load.
- No upstream record links or unsupported-source copy.

## Safe manual server

```bash
python3 -m http.server 8765 --bind 127.0.0.1 --directory site
```

Do not commit screenshots, plaintext HTML, browser profiles, generated semantic
vectors, or API payloads. Always restore and inspect the encrypted build before
ending the review.
