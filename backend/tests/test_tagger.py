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
from playa.tagger import TAGS, FOOD_TYPES, Tagger


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

    # --- 2026 event-format audit ----------------------------------

    def test_speed_dating_matches_without_generic_date_false_positive(self):
        self.assertIn("speed_dating", self.match("speed dating mixer"))
        self.assertIn("speed_dating", self.match("singles meetup and matchmaking"))
        self.assertNotIn("speed_dating", self.match("save the date for dinner"))

    def test_comedy_matches_and_rolls_up_to_performance(self):
        tags = self.match("stand-up comedy with local comedians")
        self.assertIn("comedy", tags)
        self.assertIn("performance", tags)
        self.assertNotIn("comedy", self.match("contact improvisation class"))

    def test_contact_improv_matches_and_rolls_up_to_dance(self):
        tags = self.match("contact improvisation workshop")
        self.assertIn("contact_improv", tags)
        self.assertIn("dance", tags)
        self.assertNotIn("contact_improv", self.match("improve your contacts"))

    def test_body_painting_matches_not_house_painting(self):
        self.assertIn("body_painting", self.match("body painting at sunset"))
        self.assertNotIn("body_painting", self.match("painting a house"))

    def test_drumming_matches_and_rolls_up_to_music(self):
        tags = self.match("participatory drum circle and percussion")
        self.assertIn("drumming", tags)
        self.assertIn("music", tags)
        self.assertNotIn("drumming", self.match("a drum of drinking water"))

    def test_flow_arts_matches_explicit_activity_only(self):
        self.assertIn("flow_arts", self.match("flow arts and poi spinning class"))
        self.assertNotIn("flow_arts", self.match("go with the flow"))

    def test_partner_dance_avoids_food_and_object_senses(self):
        self.assertIn("partner_dance", self.match("beginner partner dancing"))
        self.assertIn("partner_dance", self.match("salsa dance workshop"))
        self.assertNotIn("partner_dance", self.match("salsa and chips"))
        self.assertNotIn("partner_dance", self.match("sit on the porch swing"))

    def test_pole_dance_matches_not_generic_pole(self):
        self.assertIn("pole_dance", self.match("intro to pole dancing"))
        self.assertNotIn("pole_dance", self.match("flag pole repair"))

    def test_life_drawing_matches_not_generic_drawing(self):
        self.assertIn("life_drawing", self.match("figure drawing workshop"))
        self.assertIn("life_drawing", self.match("drawing with a nude model"))
        self.assertNotIn("life_drawing", self.match("drawing a treasure map"))

    def test_acroyoga_matches_and_rolls_up_to_yoga(self):
        tags = self.match("AcroYoga for beginners")
        self.assertIn("acroyoga", tags)
        self.assertIn("yoga", tags)
        self.assertNotIn("acroyoga", self.match("acrobatics and yogurt"))

    def test_cacao_ceremony_matches_not_generic_cocoa(self):
        self.assertIn("cacao_ceremony", self.match("cacao ceremony at dawn"))
        self.assertNotIn("cacao_ceremony", self.match("hot cocoa and cookies"))

    def test_tea_ceremony_matches_not_generic_tea(self):
        self.assertIn("tea_ceremony", self.match("traditional tea ceremony"))
        self.assertNotIn("tea_ceremony", self.match("iced tea bar"))

    def test_fiber_arts_matches_concrete_crafts_not_metaphors(self):
        self.assertIn("fiber_arts", self.match("sewing and embroidery workshop"))
        self.assertIn("fiber_arts", self.match("crochet and knitting circle"))
        self.assertNotIn("fiber_arts", self.match("weaving a story together"))

    def test_self_funded_matches_api_program_not_generic_funding(self):
        self.assertIn("self_funded", self.match("Open Self-Funded"))
        self.assertNotIn("self_funded", self.match("funded by an honorarium"))


class HaystackTests(unittest.TestCase):
    """Verify event text feeds into the tag text."""

    def setUp(self):
        self.tagger = Tagger()

    def _camp(self, **kwargs):
        defaults = dict(id="1", name="", location="", description="",
                        website="", events=[])
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
                     ),
            self.Art(id="2", name="Quiet Stone",
                     location="", description="just a rock",
                     ),
        ]
        self.tagger.tag_all_art(pieces)
        self.assertGreater(len(pieces[0].tags), 0)


class FoodTypeTests(unittest.TestCase):
    def setUp(self):
        self.t = Tagger()

    def food(self, name="", desc=""):
        return self.t.tag_event_food(Event(id="1", name=name, description=desc, time=""))

    def test_pizza(self):
        self.assertIn("pizza", self.food(name="Wood-fired Pizza Party"))

    def test_hot_dog(self):
        self.assertIn("hot-dog", self.food(name="Free Hot Dogs at noon"))

    def test_grill_and_bbq(self):
        self.assertIn("grill", self.food(name="Grilled skewers"))
        self.assertIn("bbq", self.food(desc="low and slow brisket bbq"))

    def test_grilled_cheese(self):
        self.assertIn("grilled-cheese", self.food(name="Grilled Cheese o'clock"))

    def test_tacos(self):
        self.assertIn("tacos", self.food(name="Taco Tuesday burritos"))

    def test_sandwich_avoids_ambiguous_bare_sub(self):
        self.assertIn("sandwich", self.food(name="Sub sandwich lunch"))
        self.assertNotIn("sandwich", self.food(desc="join a sub group discussion"))

    def test_pancakes_and_bacon(self):
        self.assertIn("pancakes", self.food(name="Pancake breakfast"))
        self.assertIn("bacon", self.food(desc="bacon and eggs"))
        self.assertIn("eggs", self.food(desc="bacon and eggs"))

    def test_sweets(self):
        self.assertIn("ice-cream", self.food(desc="free gelato and sundaes"))
        self.assertIn("cookies", self.food(name="Cookie hour"))

    def test_dietary_flags(self):
        self.assertIn("vegan", self.food(desc="all plant-based vegan menu"))
        self.assertIn("vegetarian", self.food(desc="veggie options"))

    def test_meal_general(self):
        self.assertIn("meal", self.food(name="Free dinner for all"))

    def test_food_false_positive_phrases_are_masked(self):
        for phrase in (
            "the cake is a lie",
            "this should be a piece of cake",
            "visual eye candy",
            "food for thought",
            "feeding your soul",
            "nourishing the mind",
            "nourishment for the spirit",
            "food storage and supplies",
            "our communal kitchen",
            "member meal plan",
        ):
            with self.subTest(phrase=phrase):
                self.assertEqual([], self.food(desc=phrase))

    def test_masked_phrase_does_not_hide_a_real_offering_elsewhere(self):
        self.assertIn("cake", self.food(desc="the cake is a lie, but we serve cake nightly"))
        self.assertIn("tacos", self.food(desc="communal kitchen serving tacos"))
        self.assertIn("meal", self.food(desc="feed your soul, then enjoy a free dinner"))

    def test_multiple_types(self):
        tags = self.food(name="Breakfast tacos", desc="with a side of bacon")
        self.assertIn("tacos", tags)
        self.assertIn("bacon", tags)

    def test_drinks_are_not_food(self):
        # The whole point of this revision: beverages produce NO food tags.
        self.assertEqual([], self.food(name="Sunset Cocktail Bar", desc="craft beer, wine, margaritas"))
        self.assertEqual([], self.food(name="Espresso & Coffee", desc="lattes, chai, matcha, cold brew"))
        self.assertEqual([], self.food(name="Juice & Smoothies", desc="fresh lemonade and kombucha"))

    def test_non_food_empty(self):
        self.assertEqual([], self.food(name="Ecstatic Dance", desc="movement workshop"))

    def test_word_boundaries(self):
        self.assertEqual([], self.food(name="Team barn", desc="steam room"))

    def test_taxonomy_floor(self):
        self.assertGreaterEqual(len(FOOD_TYPES), 25)

    def test_expanded_food_terms(self):
        self.assertIn("bbq", self.food(desc="sausage sizzle and bratwurst"))
        self.assertIn("breakfast", self.food(name="Breakfast Revival", desc="vegemite toast"))
        self.assertIn("international", self.food(desc="fresh kimchi, shawarma, and a samosa"))
        # "breakfast" is now its own bucket, not the generic 'meal'.
        self.assertNotIn("meal", self.food(name="Breakfast"))
        # Ambiguous bare "toast" (a drinking toast) must NOT trigger breakfast.
        self.assertEqual([], self.food(desc="raise a toast to the sunset"))

    def test_camp_food_types_use_name_desc_not_events(self):
        # A real food camp: the type is in its name.
        ramen = Camp(id="1", name="42 Ramen", location="", description="claim your yummy prize", website="")
        self.assertIn("noodles", self.t.food_types_for_camp(ramen))
        # A non-food camp whose EVENT merely mentions "snacks" must NOT be
        # classified as a food camp — food_types_for_camp ignores events.
        acorn = Camp(
            id="2", name="Acorn Oasis", location="",
            description="lose your nuts in carnival games and feast your eyes on squirrels",
            website="",
            events=[Event(id="e", name="Snack Break", description="free snacks", time="")],
        )
        self.assertEqual([], self.t.food_types_for_camp(acorn))


if __name__ == "__main__":
    unittest.main()
