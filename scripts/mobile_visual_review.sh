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

# The temporary capture below is intentionally plaintext, so prove up front
# that the normal build can be restored encrypted. Failing here leaves the
# existing site/ artifact untouched; waiting until after capture would risk
# replacing an encrypted local build with plaintext when .env was not loaded.
if [[ -z "${SITE_TIERS:-}" && -z "${SITE_PASSWORD:-}" ]]; then
  echo "review-mobile requires SITE_TIERS or SITE_PASSWORD in the environment."
  echo "Use 'make review-mobile' to load .env, or export one before running this script directly."
  echo "Refusing before creating a temporary plaintext site."
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

echo "==> Building temporary API-only plaintext review site"
PLAYA_REVIEW_PLAINTEXT=1
(
  cd "$PLAYA_REVIEW_ROOT"
  ALLOW_PLAINTEXT_BUILD=1 SITE_PASSWORD= SITE_TIERS= \
    BM_API_YEARS="${BM_API_YEARS:-2026}" \
    SYNC_PROVIDER="${MOBILE_REVIEW_SYNC_PROVIDER:-}" \
    SYNC_CLIENT_ID="${MOBILE_REVIEW_SYNC_CLIENT_ID:-}" \
    CAMP_LOCATION_RELEASE_AT="${CAMP_LOCATION_RELEASE_AT:-2026-08-23T00:00:00-07:00}" \
    ART_LOCATION_RELEASE_AT="${ART_LOCATION_RELEASE_AT:-2026-08-30T00:00:00-07:00}" \
    python3 -m playa build
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
match = re.search(r'<meta name="bm-brc-map-year" content="(\d{4})">', html)
assert match is not None
year = match.group(1)
# This runs after restore_encrypted_build and must prove the restored build is
# ENCRYPTED, so no private Event Data is left in site/ as plaintext. Envelope
# (tiered) builds emit `camps-data-api-YYYY-cipher`; legacy single-tier builds
# emit `-encrypted`. A bare `camps-data-api-YYYY` means `make rebuild` ran
# without encryption variables and left plaintext Event Data on disk — fail
# loudly rather than report a false "encrypted build restored".
if (
    f'id="camps-data-api-{year}-cipher"' not in html
    and f'id="camps-data-api-{year}-encrypted"' not in html
):
    raise SystemExit(
        f"restore did NOT produce an encrypted build for api-{year}: "
        "SITE_TIERS/SITE_PASSWORD were unset, so `make rebuild` left plaintext "
        "Event Data in site/. Set the encryption variables and rebuild, then "
        "delete the plaintext site/ artifact."
    )
assert html.count(f'id="gis-data-{year}"') == 1
print(f"encrypted build restored; one {year} GIS payload embedded")
PY

trap - EXIT INT TERM
echo "==> Review artifacts contain private API data: $PLAYA_REVIEW_DIR"
echo "    Inspect them, then delete that exact directory."
