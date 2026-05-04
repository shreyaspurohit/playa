"""Unit tests for playa.tagger.

Core invariants:
  1. Word boundaries prevent false matches ("art" ≠ "heart").
  2. Matching is case-insensitive.
  3. `Tagger.haystack()` combines camp name + description + event text
     so tags fire even when only an event mentions them.
  4. Every compiled pattern is valid regex (compile_tags shouldn't raise).
"""
import unittest

from playa.models import Camp, Event
from playa.tagger import TAGS, Tagger


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

    # --- New 2026 art-focused tags ---------------------------------

    def test_light_art_matches_LED_neon_glow(self):
        self.assertIn("light_art", self.match(
            "an LED-powered Mad Hatter's hat that generates music"))
        self.assertIn("light_art", self.match("softly glowing fiber optic forest"))
        self.assertIn("light_art", self.match("a luminous beacon in deep playa"))
        self.assertIn("light_art", self.match("light installation visible from K street"))

    def test_light_art_avoids_metaphorical_light(self):
        # Bare `\blight\b` would match these; the compound-only pattern
        # rejects them (deliberately leaving them untagged here rather
        # than over-tagging).
        self.assertNotIn("light_art", self.match("a light moment of joy"))
        self.assertNotIn("light_art", self.match("traveling lightheaded through the desert"))

    def test_kinetic_matches_motion_art(self):
        self.assertIn("kinetic", self.match("kinetic sculpture spinning in the wind"))
        self.assertIn("kinetic", self.match("rotating pinwheel clocks"))
        self.assertIn("kinetic", self.match("a giant pendulum overhead"))

    def test_mirror_reflection_matches(self):
        self.assertIn("mirror_reflection", self.match("walk-through kaleidoscope"))
        self.assertIn("mirror_reflection", self.match("100 mirrors reflecting the playa"))
        self.assertIn("mirror_reflection", self.match("prismatic shimmer at sunset"))

    def test_monumental_matches_size(self):
        self.assertIn("monumental", self.match("a colossal Eye, 100 feet wide"))
        self.assertIn("monumental", self.match("a towering installation"))
        self.assertIn("monumental", self.match("a 30-foot tall sculpture"))

    def test_metal_sculpture_matches_steel_bronze(self):
        self.assertIn("metal_sculpture", self.match(
            "constructed out of curved steel I-beam tunnel ribs"))
        self.assertIn("metal_sculpture", self.match("a welded bronze pillar"))

    def test_metal_sculpture_avoids_metaphorical_metal(self):
        # Bare `\bmetal\b` is intentionally excluded.
        self.assertNotIn("metal_sculpture", self.match("a metaphor for change"))
        self.assertNotIn("metal_sculpture", self.match("heavy metal music night"))

    def test_wood_sculpture_matches(self):
        self.assertIn("wood_sculpture", self.match("a manzanita driftwood portal"))
        self.assertIn("wood_sculpture", self.match("plywood archway"))
        self.assertIn("wood_sculpture", self.match("a carved wood mandala"))

    def test_portal_matches(self):
        self.assertIn("portal", self.match("a sky portal to another dimension"))
        self.assertIn("portal", self.match("step through the gateway"))
        self.assertIn("portal", self.match("an ornate threshold"))

    def test_beacon_landmark_matches(self):
        self.assertIn("beacon_landmark", self.match("a pillar of light, our beacon"))
        self.assertIn("beacon_landmark", self.match("an obelisk at deep playa"))
        self.assertIn("beacon_landmark", self.match("the lighthouse at 12:00"))

    def test_bench_seating_matches(self):
        self.assertIn("bench_seating", self.match("a bench shaped like a Cheshire cat"))
        self.assertIn("bench_seating", self.match("benches scattered along Esplanade"))

    def test_geometry_fractal_matches(self):
        self.assertIn("geometry_fractal", self.match("dynamic moving fractals"))
        self.assertIn("geometry_fractal", self.match("a geometric tower"))
        self.assertIn("geometry_fractal", self.match("sacred geometry mandala"))
        self.assertIn("geometry_fractal", self.match("a spiral staircase"))

    def test_tree_flora_matches(self):
        self.assertIn("tree_flora", self.match("a steel tree"))
        self.assertIn("tree_flora", self.match("a surprise garden of delights"))
        self.assertIn("tree_flora", self.match("blossom-covered installation"))

    # --- Cross-cutting tags (apply to both camps and art) ----------

    def test_memorial_matches(self):
        self.assertIn("memorial", self.match(
            "a poignant tribute to lives lost"))
        self.assertIn("memorial", self.match(
            "a place to grieve, reflect, and remember"))
        self.assertIn("memorial", self.match("in memory of those gone"))

    def test_transformation_matches(self):
        self.assertIn("transformation", self.match("a metamorphosis of self"))
        self.assertIn("transformation", self.match("the rebirth of an idea"))
        self.assertIn("transformation", self.match("evolving identity"))

    def test_wonderland_2026_matches_alice_themes(self):
        self.assertIn("wonderland_2026", self.match("Down the rabbit hole into infinity"))
        self.assertIn("wonderland_2026", self.match("Mad Hatter tea party"))
        self.assertIn("wonderland_2026", self.match("the Cheshire Cat smiles"))
        self.assertIn("wonderland_2026", self.match("Alice's Magic Mushroom"))

    def test_sustainability_matches(self):
        self.assertIn("sustainability", self.match(
            "leave no trace — pack out your moop"))
        self.assertIn("sustainability", self.match("solar-powered camp"))
        self.assertIn("sustainability", self.match("upcycled materials"))
        self.assertIn("sustainability", self.match("eco-conscious build"))

    # --- API-backed tags (program field) -------------------------

    def test_honorarium_matches_program_field(self):
        # API source's `program=Honorarium` flows into art_haystack.
        self.assertIn("honorarium", self.match("Honorarium"))
        self.assertIn("honorarium", self.match("recipient of an honorarium grant"))
        self.assertIn("honorarium", self.match("Honoraria 2025 awardee"))

    def test_honorarium_avoids_unrelated_uses(self):
        # `\b` keeps it tight — no substring matches.
        self.assertNotIn("honorarium", self.match("we honor the dead"))

    def test_man_pavilion_matches(self):
        self.assertIn("man_pavilion", self.match("Man Pavilion"))
        self.assertIn("man_pavilion", self.match("ManPavGrant 2025 awardee"))
        self.assertIn("man_pavilion", self.match(
            "located at 10:30 25', Man Pavilion"))

    # --- Extension to existing `space` tag ------------------------

    def test_space_now_includes_cosmic_terms(self):
        # Existing terms still work.
        self.assertIn("space", self.match("welcome to space camp"))
        # New cosmic terms.
        self.assertIn("space", self.match("a cosmic eye onto the celestial sphere"))
        self.assertIn("space", self.match("nebula-themed art piece"))
        self.assertIn("space", self.match("a starry constellation overhead"))


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


class ArtTaggerTests(unittest.TestCase):
    """Art uses the same taxonomy as camps. Verify the haystack
    includes art-specific fields (artist + category + program) on top
    of the shared name + description."""

    def setUp(self):
        from playa.models import Art
        from playa.tagger import Tagger
        self.Art = Art
        self.tagger = Tagger()

    def test_haystack_includes_artist_category_program(self):
        a = self.Art(
            id="1", name="Burning Bird",
            location="9:00 & C",
            description="A flame sculpture.",
            url="",
            artist="Jane Doe",
            category="Sculpture",
            program="Honorarium",
        )
        text = self.tagger.art_haystack(a)
        for w in ("Burning Bird", "flame sculpture", "Jane Doe",
                  "Sculpture", "Honorarium"):
            self.assertIn(w, text)

    def test_tag_art_fires_on_description(self):
        """Art uses the same regex taxonomy as camps. The exact tag
        names depend on the taxonomy; this test just confirms that
        SOMETHING fires for a description rich in arts keywords —
        validates the haystack flows into `tag()` correctly."""
        a = self.Art(
            id="1", name="Plain Title",
            location="",
            description="Interactive art sculpture with fire and sound",
            url="",
        )
        tags = self.tagger.tag_art(a)
        self.assertGreater(
            len(tags), 0,
            f"expected at least one tag to fire on rich description; got {tags}",
        )

    def test_tag_all_art_populates_in_place(self):
        pieces = [
            self.Art(id="1", name="Fire Bird",
                     location="", description="A flaming sculpture",
                     url=""),
            self.Art(id="2", name="Quiet Stone",
                     location="", description="just a rock",
                     url=""),
        ]
        self.tagger.tag_all_art(pieces)
        self.assertGreater(len(pieces[0].tags), 0)


if __name__ == "__main__":
    unittest.main()
