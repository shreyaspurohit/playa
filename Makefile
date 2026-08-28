.PHONY: help bootstrap install-backend client-install test test-py test-js \
        bundle bundle-watch fetch build rebuild food-audit food-review \
        preview review-mobile clean dev fetch-api gis-fetch gis-prepare map-audit

CLIENT_DIR  := client
BACKEND_DIR := backend

# Auto-load `.env` if present at the repo root. Lets local dev keep
# year-specific values (BRC_MAP_YEAR, BM_API_YEARS, BM_API_KEY, etc.) out
# of shell history without polluting the Makefile or shell rc.
# `.env` is gitignored — see top of .gitignore.
ifneq (,$(wildcard .env))
include .env
export
endif

help:
	@echo "============================================================"
	@echo "  PIPELINE TARGETS — cached API build + serve"
	@echo "  (each target's 'env-group:' line names a group defined in"
	@echo "   the ENV-GROUP REFERENCE section at the bottom)"
	@echo "============================================================"
	@echo ""
	@echo "  fetch           — refresh optional GIS layers and build from cached API snapshots"
	@echo "                    (never fetches Event Data)"
	@echo "                    env-group: BUILD"
	@echo ""
	@echo "  fetch-api YEAR=YYYY"
	@echo "                  — pull api.burningman.org camps + events for"
	@echo "                    one year, encrypt + cache to data/api/YYYY.json"
	@echo "                    env-group: API_FETCH"
	@echo ""
	@echo "  dev             — build from cached API snapshots"
	@echo "                    env-group: BUILD"
	@echo ""
	@echo "  rebuild         — regenerate site from cached data/api snapshots"
	@echo "                    env-group: BUILD"
	@echo ""
	@echo "  build           — emit the API-only site"
	@echo "                    env-group: BUILD"
	@echo ""
	@echo "  preview         — serve site/ at http://localhost:\$$PREVIEW_PORT"
	@echo "                    env: PREVIEW_PORT (default 8080)"
	@echo ""
	@echo "  review-mobile   — capture 390x844 tabs and optional sync modal"
	@echo "                    screenshots; restores encrypted build afterward"
	@echo "                    env: CHROME_HEADLESS_SHELL (auto-detected locally)"
	@echo ""
	@echo "============================================================"
	@echo "  SUPPORT TARGETS"
	@echo "============================================================"
	@echo ""
	@echo "  bundle          — build the Preact client bundle"
	@echo "  bundle-watch    — esbuild watch mode (fast dev iteration)"
	@echo "  food-audit      — aggregate food-classification coverage across sources"
	@echo "  food-review     — local Ollama review of Hours-not-listed candidates"
	@echo "  gis-fetch       — strictly fetch/validate official annual map layers"
	@echo "  map-audit       — derive reviewed base-grid candidates from a local"
	@echo "                    official street_lines.geojson"
	@echo ""
	@echo "============================================================"
	@echo "  HOUSEKEEPING (no env vars)"
	@echo "============================================================"
	@echo ""
	@echo "  bootstrap       — one-time setup (pip install backend + npm ci client)"
	@echo "  test            — run Python + JS test suites"
	@echo "  test-py         — Python unit tests only"
	@echo "  test-js         — JS/TS unit tests only (happy-dom)"
	@echo "  clean           — remove generated files (data, bundle, site)"
	@echo ""
	@echo "============================================================"
	@echo "  ENV-GROUP REFERENCE"
	@echo "  (referenced by the 'env-group:' lines on each target above)"
	@echo "============================================================"
	@echo ""
	@echo "  API_FETCH      api.burningman.org pull"
	@echo "                 used by: fetch-api YEAR=YYYY"
	@echo ""
	@echo "    BM_API_KEY          REQUIRED — access key from BM"
	@echo "    BM_CACHE_PASSWORD   encrypts the on-disk cache (falls back to"
	@echo "                          SITE_PASSWORD). Required for CI Release"
	@echo "                          uploads."
	@echo "    BM_API_TIMEOUT      per-request timeout in seconds (default 120)."
	@echo "                          Bump for slow servers / large payloads."
	@echo ""
	@echo "  BUILD          site assembly"
	@echo "                 used by: build, rebuild, dev, fetch"
	@echo ""
	@echo "    -- Required current-year disclosure dates --"
	@echo "    CAMP_LOCATION_RELEASE_AT  REQUIRED when the current api-YYYY"
	@echo "                              is embedded. Timezone-aware ISO"
	@echo "                              timestamp; 2026:"
	@echo "                              2026-08-23T00:00:00-07:00"
	@echo "    ART_LOCATION_RELEASE_AT   Same, for art. 2026:"
	@echo "                              2026-08-30T00:00:00-07:00"
	@echo ""
	@echo "    -- Other build knobs --"
	@echo "    SITE_PASSWORD       single-tier encryption (legacy / dev)."
	@echo "                          With SITE_TIERS unset, one of these is required"
	@echo "                          unless ALLOW_PLAINTEXT_BUILD=1."
	@echo "    ALLOW_PLAINTEXT_BUILD  explicit local-only plaintext opt-in."
	@echo "                          Never set in CI."
	@echo "    BM_API_YEARS        comma-separated years to embed,"
	@echo "                          e.g., BM_API_YEARS=2025,2026 (required)"
	@echo "                          Schedule windows are reviewed and committed"
	@echo "                          per year in backend/src/playa/schedule.py."
	@echo "    BM_CACHE_PASSWORD   used to DECRYPT data/api/YYYY.json when"
	@echo "                          building. Same key set by fetch-api."
	@echo "    BRC_MAP_YEAR       REQUIRED explicit current API/map year; no fallback"
	@echo "                          in BM_API_YEARS"
	@echo "    BM_GIS_BASE_URL    official annual GIS base URL (normally unchanged)"
	@echo "    BM_GIS_TIMEOUT     GIS request timeout in seconds (default 30)"
	@echo "    SYNC_PROVIDER      optional 'dropbox' App-folder backup; unset = off"
	@echo "    SYNC_CLIENT_ID     public Dropbox OAuth App key (required with provider)"
	@echo ""
	@echo "    -- Multi-tier (ADR D10) --"
	@echo "    SITE_TIERS          name1:pw1=src1+src2,name2:pw2=src3,…"
	@echo "                          Each named tier (password + source list)"
	@echo "                          unlocks its sources via envelope"
	@echo "                          encryption. Three planned tiers:"
	@echo "                            god-mode      every configured api-YYYY (trusted)"
	@echo "                            demigod-mode  every configured api-YYYY"
	@echo "                            spirit-mode   only api-BRC_MAP_YEAR"
	@echo "                          The build identifies spirit by NAME"
	@echo "                          ('spirit-mode' is reserved); other names"
	@echo "                          are arbitrary. Tier order doesn't"
	@echo "                          matter — lookup is by name."
	@echo "                          Unset → falls back to SITE_PASSWORD."
	@echo "                          Example (BM_API_YEARS=2025,2026):"
	@echo "                            SITE_TIERS=\"god-mode:\$$GOD_PW=api-2025+api-2026,\\"
	@echo "                                        demigod-mode:\$$DEMIGOD_PW=api-2025+api-2026,\\"
	@echo "                                        spirit-mode:\$$SPIRIT_PW=api-2026\""
	@echo "    GOD_PW              Convention-only: tier passwords composed"
	@echo "    DEMIGOD_PW            into SITE_TIERS so they don't appear"
	@echo "    SPIRIT_PW             literally in shell history / CI logs."
	@echo ""
	@echo "    -- Public access window + location embargo (D8 / D13) --"
	@echo "    SITE_UNLOCK_START   first password-free spirit-mode Playa date."
	@echo "    SITE_UNLOCK_END     first re-locked date (half-open window)."
	@echo "                          These repository variables are resolved by"
	@echo "                          CI and are independent of schedule dates and"
	@echo "                          camp/art location release timestamps."
	@echo "    BURN_OPEN=1         (workflow_dispatch input) one-shot manual"
	@echo "                          override of the date logic — force-open"
	@echo "                          / force-closed via the Actions UI."

bootstrap: install-backend client-install
	@echo "==> Ready. Try: make test"

# Editable install of the playa package. The `import playa` check skips
# reinstalling on every make invocation — pip install -e does a lot for
# a no-op. If you edit pyproject.toml, re-run manually.
install-backend:
	@python3 -c "import playa" 2>/dev/null || pip install -e ./$(BACKEND_DIR)

client-install:
	@if [ ! -d $(CLIENT_DIR)/node_modules ]; then \
		echo "==> Installing client deps"; \
		cd $(CLIENT_DIR) && npm ci; \
	fi

test: test-py test-js

test-py: install-backend
	python3 -m unittest discover -s $(BACKEND_DIR)/tests -v

test-js: client-install
	cd $(CLIENT_DIR) && npm test

bundle: client-install
	cd $(CLIENT_DIR) && npm run build

bundle-watch: client-install
	cd $(CLIENT_DIR) && npm run watch

fetch: install-backend bundle
	python3 -m playa all

# One-off API source fetch. Pulls camps, events, and art for the
# given year, encrypts (if BM_CACHE_PASSWORD or SITE_PASSWORD is
# set), writes data/api/YEAR.json. Subsequent builds with
# `BM_API_YEARS=YEAR` read
# from that file — no further API calls.
#
# Usage: BM_API_KEY=xxx make fetch-api YEAR=2025
fetch-api: install-backend
	@if [ -z "$(YEAR)" ]; then \
		echo "==> Set YEAR (e.g., make fetch-api YEAR=2025)"; exit 1; \
	fi
	@if [ -z "$$BM_API_KEY" ]; then \
		echo "==> Set BM_API_KEY in env first."; exit 1; \
	fi
	python3 -m playa api-fetch --year $(YEAR)
	@echo "==> Cached at data/api/$(YEAR).json"
	@echo "    Build with: BRC_MAP_YEAR=<current> BM_API_YEARS=<years> make rebuild"

gis-fetch: install-backend
	python3 -m playa gis-fetch

# Build-facing GIS refresh: network/schema failures are isolated because map
# overlays are optional. The explicit `gis-fetch` target above stays strict for
# annual review and troubleshooting.
gis-prepare: install-backend
	python3 -m playa gis-fetch --best-effort

# Read-only annual base-grid audit. This never participates in build/dev:
# street_lines.geojson is an operator input, not a runtime map dependency.
# Example:
#   make map-audit YEAR=2027 STREET_LINES=/tmp/brc-2027-street-lines.geojson \
#     CENTER=40.123,-119.123 ESPLANADE_RADIUS=2500
map-audit: install-backend
	@if [ -z "$(YEAR)" ] || [ -z "$(STREET_LINES)" ] || [ -z "$(CENTER)" ] || [ -z "$(ESPLANADE_RADIUS)" ]; then \
		echo "==> Required: YEAR, STREET_LINES, CENTER=LAT,LNG, ESPLANADE_RADIUS"; exit 1; \
	fi
	python3 -m playa map-audit --year $(YEAR) --street-lines "$(STREET_LINES)" \
		--center "$(CENTER)" --esplanade-radius-feet $(ESPLANADE_RADIUS)

dev: install-backend bundle
	python3 -m playa all

# The Ask feature (ADR 21) ships MiniLM vectors; generate them for real site
# builds. NOT set for the test suite, which calls the builder directly and must
# not shell out to node / fetch the model. Content-hash cached → incremental.
rebuild build dev fetch: export BM_EMBEDDINGS := 1

rebuild: install-backend bundle gis-prepare
	python3 -m playa build

build: install-backend bundle gis-prepare
	python3 -m playa build

food-audit: install-backend
	python3 -m playa food-audit

# Operator-only semantic audit. FOOD_REVIEW_ARGS can override models, sources,
# batch size, or an outside-repo checkpoint/output directory. The script
# refuses non-loopback Ollama URLs and never edits classification files.
food-review: install-backend
	python3 scripts/food_hours_ollama_audit.py $(FOOD_REVIEW_ARGS)

# Serve site/ over HTTP so PWA features work locally. `file://` is a
# `null` origin — browsers block the manifest fetch, refuse to register
# the service worker, and disable Web Share. localhost is the one
# non-HTTPS exception browsers allow for secure-context APIs, so an
# http.server on localhost is enough for full PWA testing.
PREVIEW_PORT ?= 8080
preview:
	@echo "==> Serving site/ at http://localhost:$(PREVIEW_PORT)"
	@echo "    Ctrl-C to stop. Build first with 'make rebuild' if needed."
	@cd site && python3 -m http.server $(PREVIEW_PORT)

review-mobile: install-backend client-install
	bash scripts/mobile_visual_review.sh

clean:
	rm -rf data/embeddings
	rm -f site/index.html site/privacy.html site/sw.js site/version.txt site/burn-key.json site/embeddings.json site/semantic-backend.js site/webllm-backend.js
	rm -rf $(CLIENT_DIR)/dist
	rm -rf $(BACKEND_DIR)/src/playa.egg-info $(BACKEND_DIR)/build
