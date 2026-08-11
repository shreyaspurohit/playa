#!/usr/bin/env bash
set -euo pipefail

PLAYA_REVIEW_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLAYA_REVIEW_SHELL="${CHROME_HEADLESS_SHELL:-}"

if [[ -z "$PLAYA_REVIEW_SHELL" && -d "$PLAYA_REVIEW_ROOT/chrome-headless-shell" ]]; then
  PLAYA_REVIEW_SHELL="$(
    find "$PLAYA_REVIEW_ROOT/chrome-headless-shell" \
      -type f -name chrome-headless-shell -perm -111 -print | tail -1
  )"
fi

if [[ -z "$PLAYA_REVIEW_SHELL" || ! -x "$PLAYA_REVIEW_SHELL" ]]; then
  echo "chrome-headless-shell is required. Install it outside a restricted sandbox:"
  echo "  npx --yes @puppeteer/browsers install chrome-headless-shell@stable"
  echo "Then set CHROME_HEADLESS_SHELL to the executable path."
  exit 1
fi

PLAYA_REVIEW_DIR="$(mktemp -d /tmp/playa-mobile-review.XXXXXX)"
PLAYA_REVIEW_PLAINTEXT=0

restore_encrypted_build() {
  if [[ "$PLAYA_REVIEW_PLAINTEXT" -eq 1 ]]; then
    echo "==> Restoring normal encrypted build"
    (cd "$PLAYA_REVIEW_ROOT" && make rebuild)
    PLAYA_REVIEW_PLAINTEXT=0
  fi
}

on_exit() {
  local status=$?
  trap - EXIT INT TERM
  if ! restore_encrypted_build; then
    status=1
  fi
  exit "$status"
}
trap on_exit EXIT INT TERM

echo "==> Building current client bundle"
(cd "$PLAYA_REVIEW_ROOT/client" && npm run build)

echo "==> Building temporary directory-only plaintext review site"
PLAYA_REVIEW_PLAINTEXT=1
(
  cd "$PLAYA_REVIEW_ROOT"
  SITE_PASSWORD= SITE_TIERS= BM_API_YEARS= \
    BURN_WINDOW_OPEN_FROM="${BURN_WINDOW_OPEN_FROM:-2026-08-30}" \
    BURN_WINDOW_OPEN_TO="${BURN_WINDOW_OPEN_TO:-2026-09-07}" \
    CAMP_LOCATION_RELEASE_AT="${CAMP_LOCATION_RELEASE_AT:-2026-08-23T00:00:00-07:00}" \
    ART_LOCATION_RELEASE_AT="${ART_LOCATION_RELEASE_AT:-2026-08-30T00:00:00-07:00}" \
    python3 -m playa build --sources directory
)

echo "==> Capturing 390x844 expanded/collapsed/revealed states"
node "$PLAYA_REVIEW_ROOT/scripts/mobile_visual_review.mjs" \
  "$PLAYA_REVIEW_SHELL" \
  "$PLAYA_REVIEW_ROOT/site/index.html" \
  "$PLAYA_REVIEW_DIR/screenshots" \
  "$PLAYA_REVIEW_DIR/profile"

restore_encrypted_build

python3 - "$PLAYA_REVIEW_ROOT/site/index.html" <<'PY'
import re
import sys
from pathlib import Path

html = Path(sys.argv[1]).read_text()
assert 'id="camps-data-directory-cipher"' in html
assert 'id="camps-data-directory"' not in html
match = re.search(r'<meta name="bm-directory-map-year" content="(\d{4})">', html)
assert match is not None
year = match.group(1)
assert html.count(f'id="gis-data-{year}"') == 1
print(f"encrypted build restored; one {year} GIS payload embedded")
PY

trap - EXIT INT TERM
echo "==> Review artifacts contain private directory data: $PLAYA_REVIEW_DIR"
echo "    Inspect them, then delete that exact directory."
