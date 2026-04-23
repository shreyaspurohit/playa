.PHONY: help test scrape scrape-small build rebuild tag meta merge clean

help:
	@echo "Targets:"
	@echo "  test          — run the unit test suite"
	@echo "  scrape        — full pipeline: fetch, tag, build site (~2 min)"
	@echo "  scrape-small  — scrape just 3 pages (for quick dev iteration)"
	@echo "  rebuild       — regenerate site from existing data (meta + merge + tag + build)"
	@echo "  build         — build_site only; no meta/merge/tag refresh"
	@echo "  tag           — retag + write data/camps_tagged.csv"
	@echo "  meta          — write data/meta.json from data/pages/"
	@echo "  merge         — write data/camps.csv"
	@echo "  clean         — remove generated files"
	@echo ""
	@echo "Env overrides (all optional):"
	@echo "  PAGES=N         number of listing pages to scrape (default 30)"
	@echo "  PARALLEL=N      parallel detail-fetch workers (default 5)"
	@echo "  SITE_PASSWORD   encrypt the embedded JSON (plaintext build if unset)"
	@echo "  CONTACT_EMAIL   address used in the footer mailto takedown link"

test:
	python3 -m unittest discover -s tests -v

scrape:
	python3 -m bm_camps all

scrape-small:
	PAGES=3 python3 -m bm_camps all

rebuild:
	python3 -m bm_camps meta
	python3 -m bm_camps merge
	python3 -m bm_camps tag
	python3 -m bm_camps build

build:
	python3 -m bm_camps build

tag:
	python3 -m bm_camps tag

meta:
	python3 -m bm_camps meta

merge:
	python3 -m bm_camps merge

clean:
	rm -rf data/pages/*.json data/logs/*.log
	rm -f data/camps.csv data/camps_tagged.csv data/meta.json
	rm -f site/index.html
