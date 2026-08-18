#!/usr/bin/env python3
"""Private, loopback-only Ollama audit for candidate camp/event tags.

The script proposes open-vocabulary labels, then asks a second local model to
keep only useful, repeatable labels.  Checkpoints contain IDs, fingerprints,
labels, and decisions only; source text is never written or printed.
It is advisory: it never edits ``TAGS``.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from playa.config import Config
from playa.sources import make_source


def loopback_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("Ollama URL must be an http:// loopback address")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Ollama URL must not contain credentials, query, or fragment")
    return value.rstrip("/")


def call(base: str, model: str, system: str, items: list[dict[str, Any]], timeout: int) -> dict[str, Any]:
    payload = {"model": model, "messages": [{"role": "system", "content": system},
        {"role": "user", "content": json.dumps({"items": items}, ensure_ascii=False)}],
        "stream": False, "think": False, "format": "json", "options": {"temperature": 0}}
    request = Request(base + "/api/chat", data=json.dumps(payload).encode(),
                      headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read())
        content = body.get("message", {}).get("content")
        result = json.loads(content) if isinstance(content, str) else None
    except Exception as exc:  # never expose a response body containing source text
        raise RuntimeError(f"local Ollama request failed ({type(exc).__name__})") from exc
    if not isinstance(result, dict):
        raise RuntimeError("local Ollama returned malformed structured content")
    return result


PROPOSER = """You audit Burning Man camp and event listings for useful search tags.
Return JSON only: {\"items\":[{\"token\":string,\"tags\":[string]}]}.
Suggest at most five short lowercase snake_case tags that describe an explicit
activity, service, genre, or facility. Do not invent facts, quote text, use
generic labels (camp, event, fun), or return near-duplicates. Empty tags are OK."""
VERIFIER = """You review proposed tags for Burning Man listings. Return JSON only:
{\"items\":[{\"token\":string,\"keep\":boolean,\"tags\":[string]}]}.
Keep only tags explicitly supported by the listing and useful across multiple
records. Normalize labels to lowercase snake_case and discard vague, duplicate,
unsafe, or one-off proper-name labels. Never quote or summarize listing text."""


def fingerprint(source: str, kind: str, record_id: str, name: str, description: str) -> str:
    return hashlib.sha256(json.dumps([source, kind, record_id, name, description],
        ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def records(sources: list[str], config: Config, include_art: bool) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for source_name in sources:
        snapshot = make_source(source_name).load_snapshot(config)
        for camp in snapshot.camps:
            out.append({"source": source_name, "kind": "camp", "id": camp.id,
                        "name": camp.name, "description": camp.description,
                        "fingerprint": fingerprint(source_name, "camp", camp.id, camp.name, camp.description)})
            for event in camp.events:
                out.append({"source": source_name, "kind": "event", "id": event.id,
                            "camp_id": camp.id, "name": event.name, "description": event.description,
                            "fingerprint": fingerprint(source_name, "event", event.id, event.name, event.description)})
        if include_art:
            for art in snapshot.art:
                out.append({"source": source_name, "kind": "art", "id": art.id,
                            "name": art.name, "description": art.description,
                            "fingerprint": fingerprint(source_name, "art", art.id, art.name, art.description)})
    return out


def batches(values: list[Any], size: int):
    for start in range(0, len(values), size):
        yield values[start:start + size]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", required=True, help="comma-separated api-YYYY sources")
    parser.add_argument("--output-dir", required=True, type=Path, help="checkpoint directory outside the repository")
    parser.add_argument("--ollama-url", default="http://127.0.0.1:11434")
    parser.add_argument("--model", default="qwen3:30b")
    parser.add_argument("--verifier-model", default="qwen2.5:14b")
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--timeout", type=int, default=900)
    parser.add_argument("--include-art", action="store_true")
    args = parser.parse_args(argv)
    if args.batch_size < 1:
        parser.error("--batch-size must be positive")
    base = loopback_url(args.ollama_url)
    output = args.output_dir.resolve()
    repo = Path.cwd().resolve()
    if output == repo or repo in output.parents:
        parser.error("--output-dir must be outside the repository")
    output.mkdir(parents=True, exist_ok=True)
    source_names = [s.strip() if s.strip().startswith("api-") else "api-" + s.strip()
                    for s in args.sources.split(",") if s.strip()]
    config = Config.from_env(root=repo)
    items = records(source_names, config, args.include_art)
    proposals: list[dict[str, Any]] = []
    for batch in batches(items, args.batch_size):
        prompt = [{"token": f"item-{i}", "kind": row["kind"], "name": row["name"],
                   "description": row["description"]} for i, row in enumerate(batch)]
        result = call(base, args.model, PROPOSER, prompt, args.timeout)
        by_token = {x.get("token"): x for x in result.get("items", []) if isinstance(x, dict)}
        for i, row in enumerate(batch):
            tags = by_token.get(f"item-{i}", {}).get("tags", [])
            if not isinstance(tags, list):
                tags = []
            clean = sorted({re.sub(r"[^a-z0-9]+", "_", str(t).lower()).strip("_")
                            for t in tags if str(t).strip()})[:5]
            proposals.append({**{k: row[k] for k in ("source", "kind", "id", "fingerprint")},
                              "proposed": clean})
    verified: list[dict[str, Any]] = []
    for batch in batches([p for p in proposals if p["proposed"]], args.batch_size):
        prompt = [{"token": f"item-{i}", "kind": row["kind"], "name": items[j]["name"],
                   "description": items[j]["description"], "proposed_tags": row["proposed"]}
                  for i, row in enumerate(batch)
                  for j in [next(k for k, x in enumerate(items) if x["fingerprint"] == row["fingerprint"])] ]
        result = call(base, args.verifier_model, VERIFIER, prompt, args.timeout)
        by_token = {x.get("token"): x for x in result.get("items", []) if isinstance(x, dict)}
        for i, row in enumerate(batch):
            verdict = by_token.get(f"item-{i}", {})
            tags = verdict.get("tags", row["proposed"])
            verified.append({**row, "keep": bool(verdict.get("keep")),
                             "tags": sorted(set(tags)) if isinstance(tags, list) else []})
    checkpoint = output / "tag-audit.json"
    checkpoint.write_text(json.dumps({"sources": source_names, "model": args.model,
        "verifier_model": args.verifier_model, "records": len(items), "reviews": verified}, indent=2) + "\n")
    counts = Counter(tag for row in verified if row.get("keep") for tag in row.get("tags", []))
    print(json.dumps({"records": len(items), "reviewed": len(verified), "kept_tag_counts": counts.most_common()}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
