"""Local-only semantic review for Food tab "Hours not listed" candidates.

This module deliberately does not mutate the taxonomy or apply exclusions. It
loads the same classified records as the site, sends candidate text only to a
loopback Ollama server, and writes ID-only advisory reports outside the repo.
See docs/19-food-classification-audit.md.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
import time
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from .builder import SiteBuilder
from .config import Config
from .models import Camp


REASON_CODES = {
    "PUBLIC_FOOD_OFFERING",
    "PRIVATE_OR_MEMBERS_ONLY",
    "FIGURATIVE_THEME_OR_JOKE",
    "FACILITY_OR_SUPPLIES",
    "REQUEST_OR_BYO",
    "NEGATED_OR_NOT_OFFERED",
    "INSUFFICIENT_EVIDENCE",
    "AMBIGUOUS",
}
VERDICTS = {"include", "exclude", "uncertain"}

SYSTEM_PROMPT = """You are reviewing a private Burning Man camp dataset.
Decide whether each item actually advertises food being served, gifted, or
otherwise made available to burners. This is a precision audit of entries
already selected by keyword rules.

Include a concrete public food offering even when no serving hours are given.
For an event item, the existence of the public event listing is evidence of an
offering when its title or description names concrete food.

Exclude food for camp members only, dues/meal plans, storage or kitchen
facilities, supplies, requests to bring food, BYO food, metaphors, themes,
jokes, negated offerings, and incidental mentions that do not promise food.
Use uncertain when the text does not establish either conclusion.

Return only the requested structured fields. Never quote, summarize, or repeat
the source text. Use exactly one of the supplied reason codes."""

RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "token": {"type": "string"},
                    "verdict": {"type": "string", "enum": sorted(VERDICTS)},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "reason_code": {"type": "string", "enum": sorted(REASON_CODES)},
                },
                "required": ["token", "verdict", "confidence", "reason_code"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["items"],
    "additionalProperties": False,
}
POLICY_DIGEST = hashlib.sha256(
    (SYSTEM_PROMPT + json.dumps(RESPONSE_SCHEMA, sort_keys=True)).encode(),
).hexdigest()
RECONCILIATION_VERSION = "primary-exclusion-veto-v1"


@dataclass(frozen=True)
class Candidate:
    source: str
    kind: str
    camp_id: str
    item_id: str
    name: str
    description: str
    food_tags: tuple[str, ...]

    @property
    def key(self) -> str:
        return f"{self.source}:{self.kind}:{self.camp_id}:{self.item_id}"

    @property
    def fingerprint(self) -> str:
        raw = json.dumps(
            [self.source, self.kind, self.camp_id, self.item_id,
             self.name, self.description, self.food_tags],
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode()
        return hashlib.sha256(raw).hexdigest()

    def prompt_item(self, token: str) -> dict[str, Any]:
        return {
            "token": token,
            "kind": self.kind,
            "name": self.name,
            "description": self.description,
            "matched_food_types": list(self.food_tags),
        }

    def identifier(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "kind": self.kind,
            "camp_id": self.camp_id,
            "item_id": self.item_id,
            "food_tags": list(self.food_tags),
            "fingerprint": self.fingerprint,
        }


@dataclass(frozen=True)
class Review:
    verdict: str
    confidence: float
    reason_code: str


def _event_has_listed_hours(parsed: dict[str, Any] | None) -> bool:
    return bool(parsed and parsed.get("start_time"))


def collect_candidates(source: str, camps: Iterable[Camp]) -> list[Candidate]:
    """Return entries that FoodView places in Hours not listed."""
    out: list[Candidate] = []
    for camp in camps:
        food_events = [event for event in camp.events if event.food_tags]
        for event in food_events:
            if not _event_has_listed_hours(event.parsed_time):
                out.append(Candidate(
                    source=source,
                    kind="event",
                    camp_id=camp.id,
                    item_id=event.id,
                    name=event.name,
                    description=event.description,
                    food_tags=tuple(event.food_tags),
                ))
        if not food_events and camp.food_tags:
            out.append(Candidate(
                source=source,
                kind="camp",
                camp_id=camp.id,
                item_id=camp.id,
                name=camp.name,
                description=camp.description,
                food_tags=tuple(camp.food_tags),
            ))
    return out


def validate_ollama_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("Ollama URL must be an http:// loopback address")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Ollama URL must not contain credentials, a query, or a fragment")
    return value.rstrip("/")


class OllamaClient:
    def __init__(self, base_url: str, timeout: int = 900):
        self.base_url = validate_ollama_url(base_url)
        self.timeout = timeout

    def _json_request(self, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        data = None if payload is None else json.dumps(payload).encode()
        request = Request(
            self.base_url + path,
            data=data,
            headers={"Content-Type": "application/json"} if data else {},
            method="POST" if data else "GET",
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                decoded = json.loads(response.read())
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
            # Do not include response bodies: a malformed model response could
            # reproduce private source text.
            raise RuntimeError(f"local Ollama request failed ({type(exc).__name__})") from exc
        if not isinstance(decoded, dict):
            raise RuntimeError("local Ollama returned a non-object response")
        return decoded

    def installed_models(self) -> dict[str, str]:
        response = self._json_request("/api/tags")
        names: dict[str, str] = {}
        for item in response.get("models", []):
            if isinstance(item, dict):
                digest = item.get("digest") if isinstance(item.get("digest"), str) else ""
                for key in ("name", "model"):
                    if isinstance(item.get(key), str):
                        names[item[key]] = digest
        return names

    def review(self, model: str, candidates: list[Candidate]) -> dict[str, Review]:
        tokens = [f"item-{i + 1}" for i in range(len(candidates))]
        prompt_items = [c.prompt_item(token) for c, token in zip(candidates, tokens)]
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps({
                    "reason_codes": sorted(REASON_CODES),
                    "response_contract": {
                        "items": [{
                            "token": "copy the input token",
                            "verdict": "include | exclude | uncertain",
                            "confidence": "number from 0 to 1",
                            "reason_code": "one supplied reason code",
                        }],
                    },
                    "items": prompt_items,
                }, ensure_ascii=False)},
            ],
            "stream": False,
            "think": False,
            "format": RESPONSE_SCHEMA,
            "options": {"temperature": 0},
        }
        try:
            response = self._json_request("/api/chat", payload)
        except RuntimeError:
            # Some locally installed models support JSON mode but reject a
            # full JSON Schema with HTTP 500. The contract is also present in
            # the prompt, and parse_reviews applies the same strict validation.
            payload["format"] = "json"
            payload.pop("think", None)
            response = self._json_request("/api/chat", payload)
        message = response.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, str):
            raise RuntimeError("local Ollama response omitted structured content")
        try:
            result = json.loads(content)
        except json.JSONDecodeError as exc:
            raise RuntimeError("local Ollama returned malformed structured content") from exc
        return parse_reviews(result, tokens)


def parse_reviews(payload: Any, expected_tokens: list[str]) -> dict[str, Review]:
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        raise ValueError("review response must contain an items array")
    expected = set(expected_tokens)
    found: dict[str, Review] = {}
    for item in payload["items"]:
        if not isinstance(item, dict):
            raise ValueError("review item must be an object")
        token = item.get("token")
        verdict = item.get("verdict")
        reason = item.get("reason_code")
        confidence = item.get("confidence")
        if token not in expected or token in found:
            raise ValueError("review response contained an unknown or duplicate token")
        if verdict not in VERDICTS or reason not in REASON_CODES:
            raise ValueError("review response contained an invalid enum value")
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
            raise ValueError("review confidence must be numeric")
        if not 0 <= float(confidence) <= 1:
            raise ValueError("review confidence must be between zero and one")
        found[token] = Review(verdict, float(confidence), reason)
    if set(found) != expected:
        raise ValueError("review response omitted one or more tokens")
    return found


def reconcile(primary: Review, verifier: Review, threshold: float) -> str:
    if (
        primary.verdict == verifier.verdict
        and primary.verdict in {"include", "exclude"}
        and primary.confidence >= threshold
        and verifier.confidence >= threshold
    ):
        return primary.verdict
    return "manual-review"


def reconcile_three(
    primary: Review, verifier: Review, adjudicator: Review, threshold: float,
) -> str:
    votes = Counter(
        review.verdict
        for review in (primary, verifier, adjudicator)
        if review.verdict in {"include", "exclude"}
        and review.confidence >= threshold
    )
    if votes["include"] >= 2:
        return "include"
    # The verifier and adjudicator may be related model sizes (our local
    # default uses qwen2.5:32b + qwen2.5:14b). Do not let that correlated pair
    # remove an item that the strongest primary explicitly called an offering.
    # A primary "uncertain" is also insufficient evidence for automatic
    # removal; keep it in the manual queue.
    if votes["exclude"] >= 2 and primary.verdict == "exclude":
        return "exclude"
    return "manual-review"


def _atomic_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, raw_path = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(raw_path, path)
    except BaseException:
        try:
            os.unlink(raw_path)
        except FileNotFoundError:
            pass
        raise


def _load_checkpoint(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "models": {}}
    payload = json.loads(path.read_text())
    if payload.get("version") != 1 or not isinstance(payload.get("models"), dict):
        raise RuntimeError("unsupported food-review checkpoint format")
    return payload


def prepare_checkpoint(
    checkpoint: dict[str, Any], model_digests: dict[str, str],
) -> dict[str, Any]:
    """Invalidate cached decisions when policy text or model weights drift."""
    saved_policy = checkpoint.get("policy_digest")
    if saved_policy is not None and saved_policy != POLICY_DIGEST:
        checkpoint = {
            "version": 1,
            "policy_digest": POLICY_DIGEST,
            "model_digests": {},
            "models": {},
        }
    checkpoint["policy_digest"] = POLICY_DIGEST
    saved_digests = checkpoint.setdefault("model_digests", {})
    caches = checkpoint.setdefault("models", {})
    for model, digest in model_digests.items():
        if model in saved_digests and saved_digests[model] != digest:
            caches.pop(model, None)
        saved_digests[model] = digest
    return checkpoint


def _review_model(
    client: OllamaClient,
    model: str,
    candidates: list[Candidate],
    batch_size: int,
    checkpoint: dict[str, Any],
    checkpoint_path: Path,
) -> dict[str, Review]:
    cache = checkpoint["models"].setdefault(model, {})
    reviews: dict[str, Review] = {}
    pending: list[Candidate] = []
    for candidate in candidates:
        saved = cache.get(candidate.key)
        if isinstance(saved, dict) and saved.get("fingerprint") == candidate.fingerprint:
            try:
                reviews[candidate.key] = Review(
                    verdict=saved["verdict"],
                    confidence=float(saved["confidence"]),
                    reason_code=saved["reason_code"],
                )
                continue
            except (KeyError, TypeError, ValueError):
                pass
        pending.append(candidate)

    completed = len(candidates) - len(pending)
    if completed:
        print(f"  {model}: resumed {completed}/{len(candidates)} ID-only decisions")
    for offset in range(0, len(pending), batch_size):
        batch = pending[offset:offset + batch_size]
        last_error: Exception | None = None
        for attempt in range(2):
            try:
                by_token = client.review(model, batch)
                last_error = None
                break
            except (RuntimeError, ValueError) as exc:
                last_error = exc
                if attempt == 0:
                    time.sleep(1)
        if last_error is not None:
            raise RuntimeError(
                f"{model} failed structured validation twice; no source text was logged",
            ) from last_error
        for index, candidate in enumerate(batch, start=1):
            review = by_token[f"item-{index}"]
            reviews[candidate.key] = review
            cache[candidate.key] = {
                "fingerprint": candidate.fingerprint,
                **asdict(review),
            }
        _atomic_json(checkpoint_path, checkpoint)
        completed += len(batch)
        print(f"  {model}: reviewed {completed}/{len(candidates)}")
    return reviews


def _resolve_sources(value: str | None, config: Config) -> list[str]:
    if value and value.strip():
        return [part.strip() for part in value.split(",") if part.strip()]
    return ["directory", *[f"api-{year}" for year in config.parsed_api_years()]]


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Review Food Hours-not-listed candidates with local Ollama",
    )
    parser.add_argument("--sources", help="comma-separated directory/api-YYYY sources")
    parser.add_argument("--model", default=os.environ.get("FOOD_REVIEW_MODEL", "qwen3:30b"))
    parser.add_argument(
        "--verifier-model",
        default=os.environ.get("FOOD_REVIEW_VERIFIER_MODEL", "qwen2.5:32b"),
    )
    parser.add_argument(
        "--adjudicator-model",
        default=os.environ.get("FOOD_REVIEW_ADJUDICATOR_MODEL", ""),
        help="optional third model, run only for unresolved two-model decisions",
    )
    parser.add_argument(
        "--ollama-url",
        default=os.environ.get("FOOD_REVIEW_OLLAMA_URL", "http://127.0.0.1:11434"),
    )
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--timeout", type=int, default=900)
    parser.add_argument("--confidence", type=float, default=0.80)
    parser.add_argument("--output-dir", type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.batch_size < 1:
        raise SystemExit("--batch-size must be positive")
    if not 0 <= args.confidence <= 1:
        raise SystemExit("--confidence must be between zero and one")
    requested_models = [args.model, args.verifier_model]
    if args.adjudicator_model:
        requested_models.append(args.adjudicator_model)
    if len(set(requested_models)) != len(requested_models):
        raise SystemExit("review models must be different")

    config = Config.from_env()
    sources = _resolve_sources(args.sources, config)
    builder = SiteBuilder(config, sources=sources)
    candidates: list[Candidate] = []
    source_counts: Counter[tuple[str, str]] = Counter()
    for source in sources:
        found = collect_candidates(source, builder.load_camps_for_source(source))
        candidates.extend(found)
        source_counts.update((candidate.source, candidate.kind) for candidate in found)

    print(f"Food Hours-not-listed candidates: {len(candidates)}")
    for (source, kind), count in sorted(source_counts.items()):
        print(f"  {source} {kind}: {count}")
    if not candidates:
        return 0

    output_dir = args.output_dir or Path(tempfile.mkdtemp(prefix="playa-food-review-"))
    output_dir = output_dir.resolve()
    try:
        output_dir.relative_to(config.root.resolve())
    except ValueError:
        pass
    else:
        raise SystemExit("--output-dir must be outside the repository")
    output_dir.mkdir(parents=True, exist_ok=True)

    client = OllamaClient(args.ollama_url, timeout=args.timeout)
    installed = client.installed_models()
    missing = [model for model in requested_models if model not in installed]
    if missing:
        raise SystemExit(
            "Required model(s) are not installed locally: " + ", ".join(missing)
            + ". The audit never pulls models automatically.",
        )

    checkpoint_path = output_dir / "checkpoint.json"
    checkpoint = prepare_checkpoint(
        _load_checkpoint(checkpoint_path),
        {model: installed[model] for model in requested_models},
    )
    primary = _review_model(
        client, args.model, candidates, args.batch_size, checkpoint, checkpoint_path,
    )
    verifier = _review_model(
        client, args.verifier_model, candidates, args.batch_size, checkpoint, checkpoint_path,
    )
    unresolved = [
        candidate for candidate in candidates
        if reconcile(primary[candidate.key], verifier[candidate.key], args.confidence)
        == "manual-review"
    ]
    adjudicator: dict[str, Review] = {}
    if args.adjudicator_model and unresolved:
        print(f"  {args.adjudicator_model}: adjudicating {len(unresolved)} unresolved decisions")
        adjudicator = _review_model(
            client, args.adjudicator_model, unresolved, args.batch_size,
            checkpoint, checkpoint_path,
        )

    decisions: Counter[str] = Counter()
    reason_pairs: Counter[str] = Counter()
    report_items: list[dict[str, Any]] = []
    proposals: list[dict[str, Any]] = []
    manual: list[dict[str, Any]] = []
    for candidate in candidates:
        first = primary[candidate.key]
        second = verifier[candidate.key]
        decision = reconcile(first, second, args.confidence)
        third = adjudicator.get(candidate.key)
        if decision == "manual-review" and third is not None:
            decision = reconcile_three(first, second, third, args.confidence)
        decisions[decision] += 1
        reasons = [first.reason_code, second.reason_code]
        if third is not None:
            reasons.append(third.reason_code)
        reason_pairs[" / ".join(reasons)] += 1
        item = {
            **candidate.identifier(),
            "decision": decision,
            "primary": asdict(first),
            "verifier": asdict(second),
            "adjudicator": asdict(third) if third is not None else None,
        }
        report_items.append(item)
        if decision == "exclude":
            proposals.append(candidate.identifier())
        elif decision == "manual-review":
            manual.append(candidate.identifier())

    generated = datetime.now(timezone.utc).isoformat()
    metadata = {
        "generated_at": generated,
        "sources": sources,
        "models": [
            {"name": model, "digest": installed[model]}
            for model in requested_models
        ],
        "policy_digest": POLICY_DIGEST,
        "reconciliation_version": RECONCILIATION_VERSION,
        "confidence_threshold": args.confidence,
        "candidate_count": len(candidates),
        "contains_source_text": False,
    }
    _atomic_json(output_dir / "food-hours-review.json", {**metadata, "items": report_items})
    _atomic_json(output_dir / "proposed-exclusions.json", {**metadata, "items": proposals})
    _atomic_json(output_dir / "manual-review.json", {**metadata, "items": manual})

    print("Reconciled decisions:")
    for decision in ("include", "exclude", "manual-review"):
        print(f"  {decision}: {decisions[decision]}")
    print("Reason-combination counts:")
    for reason, count in reason_pairs.most_common():
        print(f"  {count:4d}  {reason}")
    print(f"ID-only reports: {output_dir}")
    print("No taxonomy or exclusion files were changed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
