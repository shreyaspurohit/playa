"""Unit tests for bm_camps.tagger.

Core invariants:
  1. Word boundaries prevent false matches ("art" ≠ "heart").
  2. Matching is case-insensitive.
  3. `Tagger.haystack()` combines camp name + description + event text
     so tags fire even when only an event mentions them.
  4. Every compiled pattern is valid regex (compile_tags shouldn't raise).
"""
import unittest

from bm_camps.models import Camp, Event
from bm_camps.tagger import TAGS, Tagger


class TaxonomyTests(unittest.TestCase):
    def test_taxonomy_not_empty(self):
        self.assertGreater(len(TAGS), 100)

    def test_every_tag_has_at_least_one_pattern(self):
        for name, pats in TAGS.items():
            self.assertTrue(pats, f"tag '{name}' has no patterns")

    def test_core_tags_present(self):
        # Anchor tags the project spec explicitly mentioned.
        for required in ("food", "vegan", "vegetarian", "sex", "cuddles", "art"):
            self.assertIn(required, TAGS, f"expected tag '{required}' in taxonomy")

    def test_tagger_compiles_all_patterns(self):
        tagger = Tagger()
        self.assertEqual(set(tagger.compiled), set(TAGS))


class TagMatchingTests(unittest.TestCase):
    def setUp(self):
        self.tagger = Tagger()

    def match(self, text: str) -> set[str]:
        return set(self.tagger.tag(text))

    def test_food_and_specific_subtypes(self):
        tags = self.match("we serve bacon and pancakes all morning")
        self.assertIn("bacon", tags)
        self.assertIn("pancakes", tags)
        self.assertIn("food", tags)

    def test_case_insensitive(self):
        self.assertIn("yoga", self.match("YOGA AT SUNRISE"))
        self.assertIn("yoga", self.match("Yoga at sunrise"))

    def test_word_boundaries_prevent_art_in_heart(self):
        self.assertNotIn("art", self.match("love and heart, deeply felt"))

    def test_art_still_matches_real_art(self):
        self.assertIn("art", self.match("we host art workshops"))

    def test_breathwork_matches(self):
        self.assertIn("breathwork", self.match("daily pranayama and breathwork sessions"))

    def test_cuddles_singular_and_plural(self):
        self.assertIn("cuddles", self.match("join our cuddle puddle"))
        self.assertIn("cuddles", self.match("cuddles at dusk"))

    def test_multiple_tags_from_one_string(self):
        tags = self.match("Vegan pancakes and yoga at our bar")
        for required in ("vegan", "pancakes", "yoga", "bar", "food"):
            self.assertIn(required, tags)

    def test_sex_tagged(self):
        self.assertIn("sex", self.match("adult play party for grown-ups"))

    def test_empty_string_yields_no_tags(self):
        self.assertEqual(self.match(""), set())

    def test_unrelated_text_yields_no_tags(self):
        self.assertEqual(self.match("xyz"), set())

    def test_coffee_not_matched_by_coffin(self):
        self.assertNotIn("coffee", self.match("the coffin is made of wood"))
        self.assertIn("coffee", self.match("free coffee and espresso"))


class HaystackTests(unittest.TestCase):
    """Verify event text feeds into the tag text."""

    def setUp(self):
        self.tagger = Tagger()

    def _camp(self, **kwargs):
        defaults = dict(id="1", name="", location="", description="",
                        website="", url="https://example/", events=[])
        defaults.update(kwargs)
        return Camp(**defaults)

    def test_haystack_includes_events(self):
        camp = self._camp(
            name="Yoga Camp",
            description="morning classes",
            events=[Event(id="e1", name="Breathwork", description="Pranayama", time="")],
        )
        text = Tagger.haystack(camp)
        for word in ("Yoga Camp", "morning classes", "Breathwork", "Pranayama"):
            self.assertIn(word, text)

    def test_tag_camp_fires_on_event_text_only(self):
        camp = self._camp(
            name="Generic Tent",
            description="a camp",
            events=[Event(id="e1", name="Breathwork session",
                          description="come breathe", time="")],
        )
        tags = set(self.tagger.tag_camp(camp))
        self.assertIn("breathwork", tags)


if __name__ == "__main__":
    unittest.main()
