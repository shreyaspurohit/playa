.PHONY: help bootstrap install-backend client-install test test-py test-js \
        bundle bundle-watch fetch fetch-small build rebuild tag meta merge \
        preview clean dev snapshot-pages

CLIENT_DIR  := client
BACKEND_DIR := backend

help:
	@echo "Targets:"
	@echo "  bootstrap       — one-time setup (pip install backend + npm ci client)"
	@echo "  test            — run both Python and JS test suites"
	@echo "  test-py         — Python unit tests only"
	@echo "  test-js         — JS/TS unit tests only (happy-dom)"
	@echo "  bundle          — build the Preact client bundle"
	@echo "  bundle-watch    — esbuild watch mode (for fast dev iteration)"
	@echo "  dev             — fetch once if cache is empty, otherwise rebuild"
	@echo "  fetch           — bundle + full pipeline (snapshot old, pull, tag, build site)"
	@echo "  fetch-small     — pull just 3 pages (quick dev iteration)"
	@echo "  rebuild         — bundle + regenerate site from existing data"
	@echo "  build           — bundle + build_site only"
	@echo "  tag             — retag + write data/camps_tagged.csv"
	@echo "  meta            — write data/meta.json"
	@echo "  merge           — write data/camps.csv"
	@echo "  preview         — serve site/ at http://localhost:8080"
	@echo "                    (needed for PWA/SW/manifest — file:// can't)"
	@echo "  clean           — remove generated files (data, bundle, site)"
	@echo ""
	@echo "Env overrides (all optional):"
	@echo "  PAGES=N         number of listing pages to pull (default 30)"
	@echo "  PARALLEL=N      parallel detail-fetch workers (default 5)"
	@echo "  SITE_PASSWORD   encrypt the embedded JSON (plaintext build if unset)"
	@echo "  CONTACT_EMAIL   address used in the footer mailto takedown link"

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
