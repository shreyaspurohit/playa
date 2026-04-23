.PHONY: help bootstrap install-backend client-install test test-py test-js \
        bundle bundle-watch scrape scrape-small build rebuild tag meta merge clean

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
	@echo "  scrape          — bundle + full pipeline (fetch, tag, build site)"
	@echo "  scrape-small    — scrape just 3 pages (quick dev iteration)"
	@echo "  rebuild         — bundle + regenerate site from existing data"
	@echo "  build           — bundle + build_site only"
	@echo "  tag             — retag + write data/camps_tagged.csv"
	@echo "  meta            — write data/meta.json"
	@echo "  merge           — write data/camps.csv"
	@echo "  clean           — remove generated files (data, bundle, site)"
	@echo ""
	@echo "Env overrides (all optional):"
	@echo "  PAGES=N         number of listing pages to scrape (default 30)"
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

scrape: install-backend bundle
	python3 -m playa all

scrape-small: install-backend bundle
	PAGES=3 python3 -m playa all

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

clean:
	rm -rf data/pages/*.json data/logs/*.log
	rm -f data/camps.csv data/camps_tagged.csv data/meta.json
	rm -f site/index.html
	rm -rf $(CLIENT_DIR)/dist
	rm -rf $(BACKEND_DIR)/src/playa.egg-info $(BACKEND_DIR)/build
