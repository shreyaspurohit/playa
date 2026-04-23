"""Unit tests for bm_camps.timeparser.

Fixtures are drawn from actual shapes seen in the scraped corpus (4167
events). The invariants we care about:
  * AM/PM ↔ 24h conversion is correct at the 12:00 AM / 12:00 PM boundaries
  * Week map derivation picks the most frequent (day, M/D) per day
  * Display strings are stable and year-free
  * Unknown formats return None gracefully
"""
import unittest

from bm_camps.timeparser import (
    WEEK_ORDER,
    _compact_days,
    _to_12h,
    _to_24h,
    annotate_events,
    derive_week_map,
    format_display,
    parse_event_time,
)


class TimeConversionTests(unittest.TestCase):
    def test_am_pm_to_24h(self):
        self.assertEqual(_to_24h("10:00", "AM"), "10:00")
        self.assertEqual(_to_24h("10:00", "PM"), "22:00")
        self.assertEqual(_to_24h("12:00", "AM"), "00:00")    # midnight boundary
        self.assertEqual(_to_24h("12:00", "PM"), "12:00")    # noon
        self.assertEqual(_to_24h("12:30", "AM"), "00:30")
        self.assertEqual(_to_24h("12:30", "PM"), "12:30")
        self.assertEqual(_to_24h("1:00", "PM"), "13:00")
        self.assertEqual(_to_24h("11:59", "PM"), "23:59")

    def test_24h_to_12h(self):
        self.assertEqual(_to_12h("00:00"), "12:00 AM")
        self.assertEqual(_to_12h("00:30"), "12:30 AM")
        self.assertEqual(_to_12h("12:00"), "12:00 PM")
        self.assertEqual(_to_12h("13:00"), "1:00 PM")
        self.assertEqual(_to_12h("23:59"), "11:59 PM")


class ParseBeginsFormTests(unittest.TestCase):
    def test_single_day(self):
        p = parse_event_time("Begins Tue (8/27) at 10:00 AM, Ends 11:15 AM")
        self.assertEqual(p["kind"], "single")
        self.assertEqual(p["days"], ["Tue"])
        self.assertEqual(p["start_day"], "Tue")
        self.assertEqual(p["start_date"], "8/27")
        self.assertEqual(p["start_time"], "10:00")
        self.assertEqual(p["end_day"], "Tue")
        self.assertEqual(p["end_time"], "11:15")

    def test_spans_midnight(self):
        p = parse_event_time("Begins Thu (8/29) at 9:00 PM, Ends Fri at 2:00 AM")
        self.assertEqual(p["kind"], "single")
        self.assertEqual(p["start_day"], "Thu")
        self.assertEqual(p["start_date"], "8/29")
        self.assertEqual(p["start_time"], "21:00")
        self.assertEqual(p["end_day"], "Fri")
        self.assertEqual(p["end_time"], "02:00")

    def test_pm_end(self):
        p = parse_event_time("Begins Sat (8/31) at 11:00 AM, Ends 1:00 PM")
        self.assertEqual(p["start_time"], "11:00")
        self.assertEqual(p["end_time"], "13:00")

    def test_start_noon(self):
        p = parse_event_time("Begins Mon (8/26) at 12:00 PM, Ends 1:30 PM")
        self.assertEqual(p["start_time"], "12:00")
        self.assertEqual(p["end_time"], "13:30")


class ParseFromFormTests(unittest.TestCase):
    def test_multi_day_recurring(self):
        p = parse_event_time("From 11:00 AM to 3:00 PM on Mon, Tue, Wed, Thu, Fri")
        self.assertEqual(p["kind"], "recurring")
        self.assertEqual(p["days"], ["Mon", "Tue", "Wed", "Thu", "Fri"])
        self.assertEqual(p["start_time"], "11:00")
        self.assertEqual(p["end_time"], "15:00")
        self.assertIsNone(p["start_date"])

    def test_non_contiguous_recurring(self):
        p = parse_event_time("From 10:00 AM to 11:00 AM on Tue, Thu")
        self.assertEqual(p["days"], ["Tue", "Thu"])

    def test_spans_seven_days(self):
        p = parse_event_time("From 10:00 AM to 11:00 PM on Sun, Mon, Tue, Wed, Thu, Fri, Sat")
        self.assertEqual(len(p["days"]), 7)

    def test_single_day_recurring(self):
        p = parse_event_time("From 5:00 PM to 6:00 PM on Wed")
        self.assertEqual(p["days"], ["Wed"])

    def test_accepts_day2_suffix(self):
        # The directory uses "Sun2" / "Mon2" to disambiguate the second
        # occurrence (closing Sunday vs opening Sunday). We collapse them
        # to the base day name — duplicates get deduped.
        p = parse_event_time("From 10:00 AM to 5:00 PM on Mon, Tue, Wed, Thu, Fri, Sat, Sun2")
        self.assertEqual(p["days"], ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])
        p = parse_event_time("From 9:00 AM to 11:00 AM on Sun, Mon, Sun2, Mon2")
        self.assertEqual(p["days"], ["Sun", "Mon"])


class ParseUnknownFormatTests(unittest.TestCase):
    def test_empty_returns_none(self):
        self.assertIsNone(parse_event_time(""))
        self.assertIsNone(parse_event_time(None))
        self.assertIsNone(parse_event_time("   "))

    def test_unrecognized_returns_none(self):
        self.assertIsNone(parse_event_time("Sometime next week"))
        self.assertIsNone(parse_event_time("All day, every day"))

    def test_malformed_day_returns_none(self):
        self.assertIsNone(
            parse_event_time("Begins Zzz (8/27) at 10:00 AM, Ends 11:00 AM")
        )


class WeekMapTests(unittest.TestCase):
    def test_derives_from_single_events(self):
        parses = [
            parse_event_time("Begins Mon (8/26) at 10:00 AM, Ends 11:00 AM"),
            parse_event_time("Begins Tue (8/27) at 10:00 AM, Ends 11:00 AM"),
            parse_event_time("Begins Wed (8/28) at 10:00 AM, Ends 11:00 AM"),
        ]
        m = derive_week_map(parses)
        self.assertEqual(m, {"Mon": "8/26", "Tue": "8/27", "Wed": "8/28"})

    def test_ignores_recurring_events(self):
        # Recurring events have no start_date → shouldn't contribute.
        parses = [
            parse_event_time("From 11:00 AM to 3:00 PM on Mon, Tue"),
        ]
        self.assertEqual(derive_week_map(parses), {})

    def test_most_common_wins_on_conflict(self):
        parses = [
            parse_event_time("Begins Sun (8/25) at 10:00 AM, Ends 11:00 AM"),
            parse_event_time("Begins Sun (8/25) at 2:00 PM, Ends 3:00 PM"),
            parse_event_time("Begins Sun (9/1) at 10:00 AM, Ends 11:00 AM"),
        ]
        m = derive_week_map(parses)
        # Sun had 2 votes for 8/25 vs 1 for 9/1 → 8/25 wins
        self.assertEqual(m["Sun"], "8/25")


class CompactDaysTests(unittest.TestCase):
    def test_contiguous_run(self):
        self.assertEqual(_compact_days(["Mon", "Tue", "Wed", "Thu", "Fri"]), "Mon–Fri")
        self.assertEqual(_compact_days(["Tue", "Wed", "Thu"]), "Tue–Thu")

    def test_daily(self):
        self.assertEqual(_compact_days(list(WEEK_ORDER)), "Daily")

    def test_non_contiguous(self):
        self.assertEqual(_compact_days(["Tue", "Thu"]), "Tue, Thu")
        self.assertEqual(_compact_days(["Mon", "Wed", "Fri"]), "Mon, Wed, Fri")

    def test_single_day(self):
        self.assertEqual(_compact_days(["Mon"]), "Mon")

    def test_two_day_contiguous_stays_comma(self):
        # Two days is a range of 2; we leave them comma-joined to avoid
        # confusing "Mon–Tue" which reads like a single day label.
        self.assertEqual(_compact_days(["Mon", "Tue"]), "Mon, Tue")


class FormatDisplayTests(unittest.TestCase):
    def setUp(self):
        self.week_map = {"Mon": "8/26", "Tue": "8/27", "Wed": "8/28",
                         "Thu": "8/29", "Fri": "8/30", "Sat": "8/31",
                         "Sun": "9/1"}

    def test_single_day_event(self):
        p = parse_event_time("Begins Tue (8/27) at 10:00 AM, Ends 11:15 AM")
        s = format_display(p, self.week_map)
        self.assertEqual(s, "Tue 8/27 · 10:00 AM – 11:15 AM")

    def test_spans_midnight_with_map(self):
        p = parse_event_time("Begins Thu (8/29) at 9:00 PM, Ends Fri at 2:00 AM")
        s = format_display(p, self.week_map)
        self.assertEqual(s, "Thu 8/29 9:00 PM – Fri 8/30 2:00 AM")

    def test_recurring_with_starts_annotation(self):
        p = parse_event_time("From 11:00 AM to 3:00 PM on Mon, Tue, Wed, Thu, Fri")
        s = format_display(p, self.week_map)
        self.assertEqual(s, "Mon–Fri · 11:00 AM – 3:00 PM (starts 8/26)")

    def test_recurring_without_map_omits_starts(self):
        p = parse_event_time("From 11:00 AM to 3:00 PM on Mon, Tue, Wed, Thu, Fri")
        s = format_display(p, {})
        self.assertEqual(s, "Mon–Fri · 11:00 AM – 3:00 PM")

    def test_none_input_returns_none(self):
        self.assertIsNone(format_display(None, self.week_map))

    def test_no_year_in_any_output(self):
        # Belt-and-suspenders: the display should never include a 4-digit year.
        for raw in [
            "Begins Tue (8/27) at 10:00 AM, Ends 11:15 AM",
            "Begins Thu (8/29) at 9:00 PM, Ends Fri at 2:00 AM",
            "From 11:00 AM to 3:00 PM on Mon, Tue, Wed, Thu, Fri",
        ]:
            s = format_display(parse_event_time(raw), self.week_map)
            self.assertNotRegex(s, r"\b20\d{2}\b")


class AnnotateEventsTests(unittest.TestCase):
    def test_end_to_end(self):
        raws = [
            "Begins Mon (8/26) at 10:00 AM, Ends 11:00 AM",
            "Begins Tue (8/27) at 2:00 PM, Ends 3:00 PM",
            "From 11:00 AM to 3:00 PM on Mon, Tue, Wed, Thu, Fri",
            "Something the parser doesn't know",
        ]
        out = annotate_events(raws)
        self.assertEqual(out[0], "Mon 8/26 · 10:00 AM – 11:00 AM")
        self.assertEqual(out[1], "Tue 8/27 · 2:00 PM – 3:00 PM")
        # Recurring got the starts annotation from the derived week map.
        self.assertEqual(out[2], "Mon–Fri · 11:00 AM – 3:00 PM (starts 8/26)")
        # Unparsed → empty string.
        self.assertEqual(out[3], "")


if __name__ == "__main__":
    unittest.main()
