#!/usr/bin/env bash
# Thin compat shim. The real pipeline lives in playa.cli:cmd_all.
# Kept so muscle-memory `bash scripts/scrape_all.sh` still works, and so
# that env-var overrides (PAGES, PARALLEL, SITE_PASSWORD, CONTACT_EMAIL)
# propagate into the Python process via its own os.environ read.
set -euo pipefail
cd "$(dirname "$0")/.."
exec python3 -m playa all "$@"
