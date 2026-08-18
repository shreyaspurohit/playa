---
title: Local Ollama tag-taxonomy audit
date: 2026-08-17
status: current
---

# Local Ollama tag-taxonomy audit

## Overview

The keyword taxonomy in `backend/src/playa/tagger.py` is maintained by a
human-reviewed, aggregate-only audit. `scripts/tag_ollama_audit.py` is an
operator tool for finding recurring candidates in a new annual API snapshot;
it is advisory and never edits the taxonomy.

## 2026 generation

For the 2026 review, `qwen3:30b` proposed labels for every camp and event,
then `qwen2.5:14b` reviewed non-empty proposals. The review produced aggregate
counts and recurring clusters; one-off proper names, vague synonyms, and
ambiguous short words were discarded. Charging stations and Wi-Fi were also
checked as narrow exact phrases: they occur often enough to be useful tags,
but broader battery/device charging and generic internet terms were not kept.

The models ran only against a loopback Ollama server. Listing text existed in
memory for the request, while checkpoints contained only source/kind/record IDs,
content fingerprints, proposed labels, and verifier decisions. Reports and
checkpoints belong outside this repository and must not be pasted into issues,
logs, or commits.

## Repeating the audit in 2027

Install the local models and ensure the annual encrypted snapshot can be read
by the normal build environment, then run from the repository root:

```bash
PYTHONPATH=backend/src python3 scripts/tag_ollama_audit.py \
  --sources 2027 \
  --output-dir /tmp/playa-tag-audit-2027 \
  --model qwen3:30b --verifier-model qwen2.5:14b
```

Use `--include-art` when auditing art as well as camps/events. The script
accepts comma-separated annual sources, writes one ID-only checkpoint named
`tag-audit.json`, and prints only record and label aggregates. `--output-dir`
must be outside the repository. It rejects non-loopback Ollama URLs and never
prints model response bodies. Adjust `--batch-size` and `--timeout` for local
hardware; use `--help` for all options.

After the run:

1. Inspect aggregate label counts and a private, ID-based sample locally.
2. Cluster synonyms and write bounded, case-insensitive word-boundary regexes.
3. Present the proposed additions for human approval; do not auto-apply model output.
4. Update `TAGS`, add positive and plausible-negative unit tests, run `make test`,
   rebuild, and recompute the aggregate baseline.
5. Delete the checkpoint and any temporary model/report artifacts when review
   is complete.

## Code references

- `scripts/tag_ollama_audit.py` — reusable proposer/verifier runner.
- `backend/src/playa/tagger.py` — approved keyword taxonomy.
- `backend/tests/test_tagger.py` — boundary and regression tests.
- `.claude/skills/update-tags/SKILL.md` — the approval and privacy workflow.
