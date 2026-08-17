import unittest

from playa.foodreview import (
    Candidate,
    Review,
    collect_candidates,
    parse_reviews,
    prepare_checkpoint,
    reconcile,
    reconcile_three,
    validate_ollama_url,
)
from playa.models import Camp, Event


def camp(*, food_tags=(), events=()):
    return Camp(
        id="camp-1", name="Camp", location="", description="Description",
        website="", food_tags=list(food_tags), events=list(events),
    )


class CandidateTests(unittest.TestCase):
    def test_collects_camp_only_hours_not_listed_entry(self):
        found = collect_candidates("api-2026", [camp(food_tags=("cake",))])
        self.assertEqual(1, len(found))
        self.assertEqual("camp", found[0].kind)

    def test_food_event_suppresses_camp_fallback(self):
        event = Event(
            id="event-1", name="Dinner", description="Food", time="",
            parsed_time={"start_time": "18:00"}, food_tags=["meal"],
        )
        self.assertEqual([], collect_candidates(
            "api-2026", [camp(food_tags=("cake",), events=(event,))],
        ))

    def test_collects_food_event_without_parsed_hours(self):
        event = Event(
            id="event-1", name="Dinner", description="Food", time="TBD",
            food_tags=["meal"],
        )
        found = collect_candidates("api-2026", [camp(events=(event,))])
        self.assertEqual(["event"], [item.kind for item in found])

    def test_non_food_event_does_not_suppress_camp_fallback(self):
        event = Event(id="event-1", name="Dance", description="Music", time="")
        found = collect_candidates(
            "api-2026", [camp(food_tags=("cake",), events=(event,))],
        )
        self.assertEqual(["camp"], [item.kind for item in found])

    def test_identifier_omits_source_text(self):
        candidate = Candidate(
            "api-2026", "camp", "1", "1", "Private name", "Private text", ("cake",),
        )
        identifier = candidate.identifier()
        self.assertNotIn("name", identifier)
        self.assertNotIn("description", identifier)


class OllamaValidationTests(unittest.TestCase):
    def test_only_loopback_http_urls_are_allowed(self):
        self.assertEqual(
            "http://127.0.0.1:11434",
            validate_ollama_url("http://127.0.0.1:11434/"),
        )
        with self.assertRaises(ValueError):
            validate_ollama_url("https://example.com")
        with self.assertRaises(ValueError):
            validate_ollama_url("http://192.168.1.5:11434")

    def test_structured_response_requires_every_token_once(self):
        result = parse_reviews({"items": [{
            "token": "item-1", "verdict": "exclude", "confidence": 0.9,
            "reason_code": "FIGURATIVE_THEME_OR_JOKE",
        }]}, ["item-1"])
        self.assertEqual("exclude", result["item-1"].verdict)
        with self.assertRaises(ValueError):
            parse_reviews({"items": []}, ["item-1"])

    def test_reconciliation_requires_high_confidence_agreement(self):
        exclude = Review("exclude", 0.9, "FIGURATIVE_THEME_OR_JOKE")
        include = Review("include", 0.95, "PUBLIC_FOOD_OFFERING")
        low = Review("exclude", 0.79, "INSUFFICIENT_EVIDENCE")
        self.assertEqual("exclude", reconcile(exclude, exclude, 0.8))
        self.assertEqual("manual-review", reconcile(exclude, include, 0.8))
        self.assertEqual("manual-review", reconcile(exclude, low, 0.8))

    def test_third_review_can_adjudicate_a_disagreement(self):
        exclude = Review("exclude", 0.9, "FIGURATIVE_THEME_OR_JOKE")
        include = Review("include", 0.95, "PUBLIC_FOOD_OFFERING")
        uncertain = Review("uncertain", 0.95, "AMBIGUOUS")
        self.assertEqual("exclude", reconcile_three(exclude, include, exclude, 0.8))
        self.assertEqual("manual-review", reconcile_three(exclude, include, uncertain, 0.8))

    def test_related_verifiers_cannot_overrule_primary_include(self):
        include = Review("include", 0.95, "PUBLIC_FOOD_OFFERING")
        exclude = Review("exclude", 0.95, "FIGURATIVE_THEME_OR_JOKE")
        self.assertEqual("manual-review", reconcile_three(include, exclude, exclude, 0.8))

    def test_checkpoint_invalidates_on_policy_or_model_drift(self):
        fresh = prepare_checkpoint({"version": 1, "models": {}}, {"model-a": "digest-a"})
        fresh["models"]["model-a"] = {"candidate": {"verdict": "include"}}
        same = prepare_checkpoint(fresh, {"model-a": "digest-a"})
        self.assertIn("candidate", same["models"]["model-a"])
        changed = prepare_checkpoint(same, {"model-a": "digest-b"})
        self.assertNotIn("model-a", changed["models"])


if __name__ == "__main__":
    unittest.main()
