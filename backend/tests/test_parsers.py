"""Unit tests for playa.parsers.

The HTML fixtures are inlined — the network-touching Fetcher.fetch() is
deliberately not covered by unit tests (would make CI flaky).
"""
import unittest

from playa.parsers import (
    ArtDetailParser, ArtListingParser, DetailParser, ListingParser, _clean,
)


LISTING_HTML = """
<ul>
    <a class="list-group-item" href="/camps/779/">
    <div class="row">
        <div class="col-sm-3">
            Yummm
        </div>
        <div class="col-sm-2">
            6:30 &amp; A
        </div>
        <div class="col-sm-7">
            Yummm is a camp dedicated to Yummmy non-food moments!
        </div>
    </div>
    </a>
    <a class="list-group-item" href="/camps/136/">
    <div class="row">
        <div class="col-sm-3">
            Yummy RUMInations
        </div>
        <div class="col-sm-2">
            5:00 &amp; B
        </div>
        <div class="col-sm-7">
            Come taste anything real or imagined.
        </div>
    </div>
    </a>
</ul>
"""

DETAIL_HTML_FULL = """<html><body><div class="container">
<h1>Camp: Yummy RUMInations</h1>
<p>
Website: <tt>https://example.com/rum</tt><br />
Location: <tt>5:00 &amp; B</tt><br />
</p>
<h2>Description: </h2>
<p>Come taste anything real or imagined at the Yum Cart! Daily experiments in vulnerability.</p>

<h2>Camp Events</h2>
<a class="list-group-item" href="/events/419/">
<div class="row">
  <div class="col-sm-3">BYOB4B: Bring your own beer for bondage</div>
  <div class="col-sm-6">A playful, entry-level rope bondage workshop.</div>
  <div class="col-sm-3">Begins Sun (8/25) at 6:00 PM, Ends 8:00 PM</div>
</div>
</a>

<a class="list-group-item" href="/events/2974/">
<div class="row">
  <div class="col-sm-3">Vinyasa Yoga + Breathwork w/DiBa</div>
  <div class="col-sm-6">Breathwork to ground you first, then Vinyasa.</div>
  <div class="col-sm-3">Begins Thu (8/29) at 11:00 AM, Ends 12:30 PM</div>
</div>
</a>

<h2>Message Yummy RUMInations</h2>
</div>
</body></html>"""

DETAIL_HTML_MINIMAL = """<html><body><div class="container">
<h1>Camp: Minimal Camp</h1>
<p>
Location: <tt>A &amp; 6:00</tt><br />
</p>
<h2>Description: </h2>
<p>Just a simple camp.</p>
</div></body></html>"""

DETAIL_HTML_NO_DESCRIPTION = """<html><body><div class="container">
<h1>Camp: Missing Desc</h1>
<p>Location: <tt>3:00 &amp; C</tt><br /></p>
</div></body></html>"""


class CleanTests(unittest.TestCase):
    def test_strips_tags(self):
        self.assertEqual(_clean("<p>hello <b>world</b></p>"), "hello world")

    def test_decodes_html_entities(self):
        self.assertEqual(_clean("6:30 &amp; A"), "6:30 & A")
        self.assertEqual(_clean("&quot;hi&quot;"), '"hi"')
        self.assertEqual(_clean("caf&#233;"), "café")

    def test_collapses_whitespace(self):
        self.assertEqual(_clean("  hello\n\n\tworld  "), "hello world")

    def test_empty_input(self):
        self.assertEqual(_clean(""), "")
        self.assertEqual(_clean("   "), "")


class ListingParserTests(unittest.TestCase):
    def test_parses_multiple_entries(self):
        entries = list(ListingParser.parse(LISTING_HTML))
        self.assertEqual(len(entries), 2)

    def test_extracts_all_fields(self):
        entries = list(ListingParser.parse(LISTING_HTML))
        cid, name, location, desc = entries[0]
        self.assertEqual(cid, "779")
        self.assertEqual(name, "Yummm")
        self.assertEqual(location, "6:30 & A")
        self.assertIn("Yummmy", desc)

    def test_decodes_entities_in_location(self):
        entries = list(ListingParser.parse(LISTING_HTML))
        _, _, location, _ = entries[1]
        self.assertEqual(location, "5:00 & B")

    def test_empty_listing_yields_nothing(self):
        self.assertEqual(list(ListingParser.parse("")), [])


class DetailParserFullTests(unittest.TestCase):
    def setUp(self):
        self.name, self.loc, self.web, self.desc, self.events = \
            DetailParser.parse(DETAIL_HTML_FULL)

    def test_name(self):
        self.assertEqual(self.name, "Yummy RUMInations")

    def test_location(self):
        self.assertEqual(self.loc, "5:00 & B")

    def test_website(self):
        self.assertEqual(self.web, "https://example.com/rum")

    def test_description(self):
        self.assertIn("Yum Cart", self.desc)
        self.assertIn("vulnerability", self.desc)

    def test_events_count(self):
        self.assertEqual(len(self.events), 2)

    def test_event_fields(self):
        ev = self.events[0]
        self.assertEqual(ev.id, "419")
        self.assertEqual(ev.name, "BYOB4B: Bring your own beer for bondage")
        self.assertIn("rope bondage", ev.description)
        self.assertIn("Sun (8/25)", ev.time)

    def test_breathwork_event_captured(self):
        self.assertEqual(self.events[1].name, "Vinyasa Yoga + Breathwork w/DiBa")


class DetailParserEdgeCases(unittest.TestCase):
    def test_minimal_no_website_no_events(self):
        name, loc, web, desc, events = DetailParser.parse(DETAIL_HTML_MINIMAL)
        self.assertEqual(name, "Minimal Camp")
        self.assertEqual(loc, "A & 6:00")
        self.assertEqual(web, "")
        self.assertIn("simple camp", desc)
        self.assertEqual(events, [])

    def test_missing_description_returns_empty(self):
        _, _, _, desc, _ = DetailParser.parse(DETAIL_HTML_NO_DESCRIPTION)
        self.assertEqual(desc, "")


# ----- artwork parsers ----------------------------------------------------

ART_LISTING_HTML = """
<ul>
    <a class="list-group-item" href="/artwork/151/">
    <div class="row">
        <div class="col-sm-3">
            1:44 Tri-Sky Portal
        </div>
        <div class="col-sm-2">
            1:44 6400&#x27;, Open Playa
        </div>
        <div class="col-sm-7">
            The 1:44 Sky Portal provides a space &hellip;
        </div>
    </div>
    </a>
    <a class="list-group-item" href="/artwork/256/">
    <div class="row">
        <div class="col-sm-3">
            Phoenix
        </div>
        <div class="col-sm-2">
            6:00 &amp; A
        </div>
        <div class="col-sm-7">
            A 30-foot fire bird.
        </div>
    </div>
    </a>
</ul>
"""

ART_DETAIL_FULL = """<html><body>
<h1>Artwork: 1:44 Tri-Sky Portal</h1>
<p>
Location: <tt>1:44 6400&#x27;, Open Playa</tt><br />
</p>
<h2>Description: </h2>
<p>The 1:44 Sky Portal provides a space that transports you from the Playa.</p>
<h2>Message 1:44 Tri-Sky Portal</h2>
</body></html>"""

ART_DETAIL_NO_DESC = """<html><body>
<h1>Artwork: Sparse Piece</h1>
<p>Location: <tt>3:00 &amp; D</tt><br /></p>
</body></html>"""


class ArtListingParserTests(unittest.TestCase):
    def test_parses_two_entries(self):
        rows = list(ArtListingParser.parse(ART_LISTING_HTML))
        self.assertEqual(len(rows), 2)

    def test_extracts_all_fields(self):
        rows = list(ArtListingParser.parse(ART_LISTING_HTML))
        aid, name, loc, desc = rows[0]
        self.assertEqual(aid, "151")
        self.assertEqual(name, "1:44 Tri-Sky Portal")
        # `'` entity decoded; whitespace collapsed.
        self.assertEqual(loc, "1:44 6400', Open Playa")
        self.assertIn("Sky Portal", desc)

    def test_decodes_entities_in_location(self):
        rows = list(ArtListingParser.parse(ART_LISTING_HTML))
        _, _, loc, _ = rows[1]
        self.assertEqual(loc, "6:00 & A")

    def test_empty_listing_yields_nothing(self):
        rows = list(ArtListingParser.parse("<html></html>"))
        self.assertEqual(rows, [])

    def test_camps_listing_does_not_match_art(self):
        """Camps + art share the same `list-group-item` row shape but
        different `/camps/` vs `/artwork/` hrefs. The art parser must
        ignore camp listings on the same page."""
        rows = list(ArtListingParser.parse(LISTING_HTML))
        self.assertEqual(rows, [])


class ArtDetailParserTests(unittest.TestCase):
    def test_extracts_name_loc_desc(self):
        name, loc, desc = ArtDetailParser.parse(ART_DETAIL_FULL)
        self.assertEqual(name, "1:44 Tri-Sky Portal")
        self.assertEqual(loc, "1:44 6400', Open Playa")
        self.assertIn("Sky Portal", desc)

    def test_no_description_returns_empty(self):
        _, _, desc = ArtDetailParser.parse(ART_DETAIL_NO_DESC)
        self.assertEqual(desc, "")

    def test_missing_h1_returns_empty_name(self):
        name, _, _ = ArtDetailParser.parse("<html></html>")
        self.assertEqual(name, "")


if __name__ == "__main__":
    unittest.main()
