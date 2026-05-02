.PHONY: help bootstrap install-backend client-install test test-py test-js \
        bundle bundle-watch fetch fetch-small build rebuild tag meta merge \
        preview clean dev snapshot-pages fetch-api

CLIENT_DIR  := client
BACKEND_DIR := backend

# Auto-load `.env` if present at the repo root. Lets local dev keep
# year-specific values (BURN_START, BURN_END, BM_API_KEY, etc.) out
# of shell history without polluting the Makefile or shell rc.
# `.env` is gitignored — see top of .gitignore.
ifneq (,$(wildcard .env))
include .env
export
endif

help:
	@echo "============================================================"
	@echo "  PIPELINE TARGETS — fetch + build + serve"
	@echo "  (each target's 'env-group:' line names a group defined in"
	@echo "   the ENV-GROUP REFERENCE section at the bottom)"
	@echo "============================================================"
	@echo ""
	@echo "  fetch           — full nightly: snapshot old, pull directory,"
	@echo "                    bundle, build site"
	@echo "                    env-group: DIR_FETCH + BUILD"
	@echo ""
	@echo "  fetch-small     — like fetch but only 3 pages (quick dev)"
	@echo "                    env-group: DIR_FETCH + BUILD (PAGES forced to 3)"
	@echo ""
	@echo "  fetch-api YEAR=YYYY"
	@echo "                  — pull api.burningman.org camps + events for"
	@echo "                    one year, encrypt + cache to data/api/YYYY.json"
	@echo "                    env-group: API_FETCH"
	@echo ""
	@echo "  dev             — fetch once if cache empty, else rebuild"
	@echo "                    env-group: DIR_FETCH (first run) + BUILD"
	@echo ""
	@echo "  rebuild         — regenerate site from cached data/pages + data/api"
	@echo "                    env-group: BUILD"
	@echo ""
	@echo "  build           — emit site/index.html only (no meta/merge/tag)"
	@echo "                    env-group: BUILD"
	@echo ""
	@echo "  preview         — serve site/ at http://localhost:\$$PREVIEW_PORT"
	@echo "                    env: PREVIEW_PORT (default 8080)"
	@echo ""
	@echo "============================================================"
	@echo "  PIECEMEAL TARGETS — individual pipeline steps (no env vars)"
	@echo "============================================================"
	@echo ""
	@echo "  bundle          — build the Preact client bundle"
	@echo "  bundle-watch    — esbuild watch mode (fast dev iteration)"
	@echo "  meta            — write data/meta.json"
	@echo "  merge           — write data/camps.csv"
	@echo "  tag             — retag + write data/camps_tagged.csv"
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
	@echo "  DIR_FETCH      directory.burningman.org pull"
	@echo "                 used by: fetch, fetch-small, dev first-run"
	@echo ""
	@echo "    PAGES=N             listing pages to pull (default 30)"
	@echo "    PARALLEL=N          parallel detail-fetch workers (default 5)"
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
	@echo "                 used by: build, rebuild, dev, fetch, fetch-small"
	@echo ""
	@echo "    -- Required dates (no code defaults — set per burn year) --"
	@echo "    BURN_WINDOW_OPEN_FROM   REQUIRED. ISO date, gate-open day"
	@echo "                              (e.g., 2026-08-30). Drives BOTH:"
	@echo "                              · the schedule view's calendar start"
	@echo "                              · the location-embargo cutoff (D8)"
	@echo "                              · the spirit-mode public-access"
	@echo "                                window's open edge (D13)"
	@echo "    BURN_WINDOW_OPEN_TO     REQUIRED. ISO date, end of burn"
	@echo "                              (e.g., 2026-09-07). Calendar end +"
	@echo "                              public-access window's close edge."
	@echo ""
	@echo "    -- Other build knobs --"
	@echo "    CONTACT_EMAIL       footer mailto takedown link"
	@echo "                          (default bm-camps@example.com)"
	@echo "    SITE_PASSWORD       single-tier encryption (legacy / dev)."
	@echo "                          Unset = plaintext build (still gzipped —"
	@echo "                          same page size as encrypted)."
	@echo "    BM_API_YEARS        comma-separated years to embed,"
	@echo "                          e.g., BM_API_YEARS=2025,2026"
	@echo "                          (defaults to directory only)"
	@echo "    BM_CACHE_PASSWORD   used to DECRYPT data/api/YYYY.json when"
	@echo "                          building. Same key set by fetch-api."
	@echo ""
	@echo "    -- Multi-tier (ADR D10) --"
	@echo "    SITE_TIERS          name1:pw1=src1+src2,name2:pw2=src3,…"
	@echo "                          Each named tier (password + source list)"
	@echo "                          unlocks its sources via envelope"
	@echo "                          encryption. Three planned tiers:"
	@echo "                            god-mode      directory + every api-YYYY"
	@echo "                            demigod-mode  every api-YYYY (no directory)"
	@echo "                            spirit-mode   only the latest api-YYYY"
	@echo "                          The build identifies spirit by NAME"
	@echo "                          ('spirit-mode' is reserved); other names"
	@echo "                          are arbitrary. Tier order doesn't"
	@echo "                          matter — lookup is by name."
	@echo "                          Unset → falls back to SITE_PASSWORD."
	@echo "                          Example (BM_API_YEARS=2025,2026):"
	@echo "                            SITE_TIERS=\"god-mode:\$$GOD_PW=directory+api-2025+api-2026,\\"
	@echo "                                        demigod-mode:\$$DEMIGOD_PW=api-2025+api-2026,\\"
	@echo "                                        spirit-mode:\$$SPIRIT_PW=api-2026\""
	@echo "    GOD_PW              Convention-only: tier passwords composed"
	@echo "    DEMIGOD_PW            into SITE_TIERS so they don't appear"
	@echo "    SPIRIT_PW             literally in shell history / CI logs."
	@echo ""
	@echo "    -- Public access window + location embargo (D8 / D13) --"
	@echo "    PLAYA_GO_LIVE       (truthy / blank) — when set, spirit-mode"
	@echo "                          auto-unlocks BEFORE BURN_WINDOW_OPEN_FROM"
	@echo "                          (early go-live). Locations stay hidden"
	@echo "                          until OPEN_FROM regardless. Doesn't"
	@echo "                          override the post-OPEN_TO closure."
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

# Move any existing data/pages/*.json into a timestamped backup under
# data/pages-backups/ before a refetch. Cheap safety net: if the
# directory HTML shape changes and the parser regresses, the old good
# fetch is still on disk (`mv data/pages-backups/<ts>/* data/pages/`
# restores it). Gitignored in full. No-op when data/pages is empty.
snapshot-pages:
	@if ls data/pages/*.json >/dev/null 2>&1; then \
		ts=$$(date +%Y%m%d-%H%M%S); \
		dest=data/pages-backups/$$ts; \
		mkdir -p $$dest; \
		mv data/pages/*.json $$dest/; \
		echo "==> Snapshot: $$dest ($$(ls $$dest | wc -l | tr -d ' ') pages)"; \
	fi

fetch: install-backend bundle snapshot-pages
	python3 -m playa all

fetch-small: install-backend bundle snapshot-pages
	PAGES=3 python3 -m playa all

# One-off API source fetch. Pulls /api/camp + /api/event for the
# given year, encrypts (if BM_CACHE_PASSWORD or SITE_PASSWORD is
# set), writes data/api/YEAR.json. Subsequent builds with
# `BM_API_YEARS=YEAR` (or `--sources directory,api-YEAR`) read
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
	@echo "    Build with: BM_API_YEARS=$(YEAR) make rebuild"

# One-command dev loop: first run fetches the full directory once;
# subsequent runs reuse the cached data/pages and just rebuild the site.
# Use `make fetch` to force a fresh pull (auto-snapshots the old one).
dev: install-backend bundle
	@if ls data/pages/*.json >/dev/null 2>&1; then \
		n=$$(ls data/pages/*.json | wc -l | tr -d ' '); \
		echo "==> Using cached data/pages ($$n pages) — rebuilding only"; \
		python3 -m playa meta && \
		python3 -m playa merge && \
		python3 -m playa tag && \
		python3 -m playa build; \
	else \
		echo "==> No cached data — fetching full directory (one-time)"; \
		python3 -m playa all; \
	fi

rebuild: install-backend bundle
	python3 -m playa meta
	python3 -m playa merge
	python3 -m playa tag
	python3 -m playa build

build: install-backend bundle
	python3 -m playa build

tag: install-backend
	python3 -m playa tag

meta: install-backend
	python3 -m playa meta

merge: install-backend
	python3 -m playa merge

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

clean:
	rm -rf data/pages/*.json data/logs/*.log
	rm -f data/camps.csv data/camps_tagged.csv data/meta.json
	rm -f site/index.html site/sw.js
	rm -rf $(CLIENT_DIR)/dist
	rm -rf $(BACKEND_DIR)/src/playa.egg-info $(BACKEND_DIR)/build
