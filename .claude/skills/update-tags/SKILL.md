---
name: update-tags
description: Audit tag coverage across configured annual API camps, events, and art, then propose additions to backend/src/playa/tagger.py. Use after an explicit API refresh or when coverage looks thin.
---

# update-tags

Grow the taxonomy without breaking existing tags. This is human-in-the-loop:
never edit taxonomy or tests until the user approves a concrete proposal.

## Baseline

Load `.env`, resolve the same annual sources as the build, and use
`make_source(source).load_snapshot(config)`. Apply `Tagger.tag_camp()` and
`Tagger.tag_art()` in memory. Record aggregate totals, zero/one-tag counts, and
the top 30 tag frequencies. Never print source records into logs or chat.

## Find and cluster gaps

Build a local word-frequency table from records with at most one tag. Skip
addresses, time strings, stopwords, one-off names, and words already covered by
existing patterns. For each useful cluster, choose one:

1. extend an existing tag;
2. propose a genuinely distinct new tag;
3. skip it as noisy or too specific.

Validate every regex against all configured annual snapshots locally. Patterns
must use word boundaries and cover reasonable variants without broad substring
matches. Report only aggregate per-source counts and variant frequencies.

## Approval boundary

Present one section per proposed tag or extension, including patterns,
additional aggregate record counts, and false-positive findings. List skipped
clusters. Ask explicitly whether to apply or adjust the proposal. Do not edit
before affirmative approval.

## Apply and verify

After approval:

1. Edit `backend/src/playa/tagger.py` in the appropriate taxonomy section.
2. Add positive and plausible negative cases to
   `backend/tests/test_tagger.py`.
3. Run `make test`.
4. Run `make rebuild` against configured API snapshots.
5. Recompute the baseline and report before/after zero-tag counts, newly tagged
   records, new tag totals, and any existing tag count that moved by more than
   five.

## Hard rules

- No broad unbounded regex.
- Never auto-apply.
- Never expose Event Data or generated record text.
- Never silence a failing test.
- Do not rename existing tags; saved filter state depends on stable names.
- Do not introduce intermediate CSV or page-cache assumptions. The source
  snapshot interface is the only audit input.
