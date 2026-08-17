"""Unit tests for the API art model."""
import unittest

from playa.models import Art


class ArtModelTests(unittest.TestCase):
    def test_round_trip_preserves_all_fields(self):
        a = Art(
            id="151", name="Sky Portal",
            location="1:44 6400', Open Playa",
            description="A meditative dome.",
            artist="Jane Doe", hometown="Reno, NV",
            category="Sculpture", program="Honorarium",
            image_url="https://cdn/x.jpg",
            year=2026, tags=["interactive_art", "sound"],
        )
        round_tripped = Art.from_dict(a.to_dict())
        self.assertEqual(round_tripped, a)

    def test_tags_default_empty(self):
        a = Art(id="1", name="x", location="", description="")
        self.assertEqual(a.tags, [])

    def test_year_coerced_to_int(self):
        a = Art.from_dict({
            "id": "1", "name": "x", "location": "", "description": "",
            "year": "2026",
        })
        self.assertEqual(a.year, 2026)

    def test_year_missing_defaults_zero(self):
        a = Art.from_dict({
            "id": "1", "name": "x", "location": "", "description": "",
        })
        self.assertEqual(a.year, 0)


if __name__ == "__main__":
    unittest.main()
