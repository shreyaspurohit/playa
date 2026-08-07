---
title: HTML Scraping Patterns
date: 2026-08-06
---

# HTML Scraping Patterns

Reference for the HTML structure fetched from `directory.burningman.org`.
Used by `ListingParser` and `DetailParser` in `backend/src/playa/parsers.py`.

## Listing page (`/camps/?page=N`)

30 pages, 50 camps each, ~1458 total.

```html
<a class="list-group-item" href="/camps/{id}/">
  <div class="row">
    <div class="col-sm-3">{name}</div>
    <div class="col-sm-2">{location}</div>
    <div class="col-sm-7">{truncated desc}</div>
  </div>
</a>
```

## Detail page (`/camps/{id}/`)

- `<h1>Camp: {name}</h1>`
- `Website: <tt>{url}</tt><br />` (optional)
- `Location: <tt>{loc}</tt><br />`
- `<h2>Description: </h2><p>{desc}</p>`
- `<h2>Camp Events</h2>` followed by repeated
  `<a class="list-group-item" href="/events/{id}/">` blocks with the same
  3-col row shape (col-sm-3 name, col-sm-6 desc, col-sm-3 time).

All regexes live at the top of `backend/src/playa/parsers.py`.

## Parser notes

- Some camps have `location: "None Listed"` or `description: "-"` — kept
  as-is; they just end up untagged.
- The fetcher sleeps 200 ms between detail fetches and retries 3× with
  backoff. Falls back to listing-page data if a detail fetch fails.
- Page count can change — check the pagination block at the bottom of any
  listing page (`<nav aria-label="Page pagination">`) and set
  `PAGES=N python -m playa all`.
- At last fetch: 30 pages, 1458 camps, 583 with website, 4167 events.
