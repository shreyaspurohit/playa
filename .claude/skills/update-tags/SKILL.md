---
name: update-tags
description: Audit current tag coverage against newly-scraped camps and propose additions to the TAGS taxonomy in bm_camps/tagger.py. Use when a fresh scrape is in data/pages/ and the untagged rate or tag-per-camp count looks low, or when the user says "update the tags", "the new camps aren't being tagged", or "find new tag themes".
---

# update-tags

Grow the tag taxonomy to cover new camps without breaking existing
tags. This is a human-in-the-loop skill — **never auto-apply changes**.
Always show the user the proposed diff and wait for explicit approval
before editing `bm_camps/tagger.py` or `tests/test_tagger.py`.

## When to run

- Fresh data landed in `data/pages/` (either local `make scrape` or a
  cron run that pulled in new camps).
- The user wants to see if the taxonomy is keeping up.
- A specific camp is coming back untagged and they want to know why.

## Baseline — capture before touching anything

```bash
cd ~/personal-code/bm-camps
python3 -m bm_camps tag 2>&1 | tee /tmp/update-tags-before.log
```

Record:
- total camps
- `untagged` count (printed by `cmd_tag`)
- top 30 tags with frequencies

Keep this — you'll compare against it in the final step.

## Step 1 — find the gap

Load every page JSON and run the current tagger against it. Collect
camps with **0 or 1 tags** — those are where coverage is thin.

```python
from pathlib import Path
import json
from bm_camps import Config, Tagger
from bm_camps.models import Camp

config = Config.from_env()
tagger = Tagger()

thin = []
for f in sorted(config.pages_dir.glob("page_*.json")):
    for raw in json.loads(f.read_text()):
        camp = Camp.from_dict(raw)
        camp.tags = tagger.tag_camp(camp)
        if len(camp.tags) <= 1:
            thin.append(camp)

print(f"{len(thin)} camps with ≤1 tag")
```

## Step 2 — mine keywords

From the thin set, build a frequency table of content words (≥4 chars,
skip stopwords + obvious common words like `camp`, `burn`, `playa`,
`come`, `bring`). Focus on nouns, verbs, and adjectives that repeat.

Ignore:
- numbers, addresses, time strings
- proper nouns that appear only once (likely camp-specific names)
- words already heavily represented in existing tags (check `TAGS` in
  `bm_camps/tagger.py` first — `grep -i "keyword" bm_camps/tagger.py`)

## Step 3 — cluster into proposed tags

For each cluster of related keywords, decide one of:

1. **Extend an existing tag** — the word fits an existing theme.
   Example: "mezcal" should go into the existing `booze` tag, not a new one.
2. **New tag** — the theme is genuinely distinct (e.g. `silent_disco`,
   `ice_bar`, `gender_play` — all were real additions in prior rounds).
3. **Skip** — too noisy, too specific to one camp, or a proper noun.

## Step 4 — validate every proposed pattern

Before proposing, each regex MUST:

1. Use `\b` word boundaries: `r"\bkeyword\b"` not `r"keyword"`. This is
   the #1 taxonomy bug. Example: `\bart\b` matches "art" but not
   "heart" or "cart"; `\byoga\b` matches "yoga" but not "yogurt".
2. Handle plurals/variants where reasonable:
   `r"\bsnuggl(?:e|es|ing|y)\b"`.
3. Grep the raw data to sanity-check:
   ```bash
   grep -ilE 'pattern' data/pages/*.json | wc -l   # how many camps
   grep -iE 'pattern' data/pages/*.json | head -5  # what do hits look like
   ```
   If hits look off-theme, refine the pattern.

## Step 5 — present the diff to the user

Show a structured proposal. One section per proposed change:

```
### Extend `booze`
+ r"\bmezcal\b"
+ r"\bsake\b"
3 new camps would tag; sample hits:
  - "Mezcal Fiesta Camp" — "Daily mezcal tastings"
  - "Sake Bombers" — "Hot sake and karaoke"
  - "Raising Spirits" — "Mezcal workshop"

### New tag `ice_bar`
patterns:
  - r"\bice\s*bar\b"
  - r"\bsub[-\s]?zero\s*(?:lounge|bar)\b"
8 new camps would tag. Sample hits:
  - "AquaZone" — "frozen ice bar with custom cocktails"
  - ...

### Skipped
  - "interstellar": only 2 hits, one is a space-theme camp already
    tagged via `space`, the other is a metaphor. Not worth a tag.
```

Then explicitly ask:
> **Apply these changes? Any to drop or adjust?**

Do not edit anything until the user responds affirmatively. If they
request changes, revise the proposal and ask again.

## Step 6 — apply (only after user approves)

1. **Edit `bm_camps/tagger.py`** — insert into the appropriate section
   of `TAGS`. For new tags, pick a section comment (e.g. `# --- Food &
   drink ---`) that fits; for extensions, add to the existing list.

2. **Edit `tests/test_tagger.py`** — every new tag gets a positive and
   (where a plausible false-positive risk exists) a negative case:
   ```python
   def test_ice_bar_tag(self):
       self.assertIn("ice_bar", self.match("frozen ice bar with cocktails"))
       # negative case: bare word shouldn't match
       self.assertNotIn("ice_bar", self.match("ice water is free"))
   ```

3. **Run tests** — must pass before the rebuild step:
   ```bash
   make test
   ```

4. **Rebuild** — regenerate the site and tagged CSV:
   ```bash
   make rebuild
   ```

5. **Compare vs baseline** — report what changed:
   - untagged: before → after
   - new tags added (and their camp counts from the new top-30 summary)
   - total camps newly tagged
   - any existing tag whose count shifted by >5 (possible over-broadening)

## Hard rules

- **No word boundaries = no merge.** Any pattern without `\b` is a bug.
- **Never auto-apply.** The diff-then-approve cycle is the whole point.
- **Never silently suppress a test failure.** If `make test` fails,
  investigate; don't edit the test to make it pass.
- **Don't touch tests for unrelated tags.** Only add tests for new
  or modified patterns.
- **Keep the taxonomy stable.** Don't rename existing tags (breaks
  users' saved filter state in localStorage).

## Debugging helpers

```bash
# How many camps already tag as X?
python3 -c "
from bm_camps import Config, Tagger
from bm_camps.models import Camp
import json, glob
t = Tagger()
n = 0
for f in glob.glob('data/pages/page_*.json'):
    for c in json.loads(open(f).read()):
        camp = Camp.from_dict(c)
        if 'YOUR_TAG_HERE' in t.tag_camp(camp):
            n += 1
print(n)
"

# What does a specific pattern match?
python3 -c "
import re
for f in sorted(__import__('pathlib').Path('data/pages').glob('page_*.json')):
    for c in __import__('json').loads(f.read_text()):
        if re.search(r'YOUR_REGEX', c['description'], re.IGNORECASE):
            print(c['name'], '—', c['description'][:120])
" | head -20
```
