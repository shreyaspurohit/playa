"""Unit tests for playa.timeparser.

Fixtures are drawn from actual shapes seen in the fetched corpus (4167
events). The invariants we care about:
  * AM/PM ↔ 24h conversion is correct at the 12:00 AM / 12:00 PM boundaries
  * Week map derivation picks the most frequent (day, M/D) per day
  * Display strings are stable and year-free
  * Unknown formats return None gracefully
"""
import unittest

from playa.timeparser import (
    WEEK_ORDER,
    _compact_days,
    _to_12h,
    _to_24h,
    annotate_events,
    canonical_week_map,
    derive_week_map,
    effective_burn_start,
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


class CanonicalWeekMapTests(unittest.TestCase):
    """The authoritative map used at build time. Walks the burn window
    day-by-day; first occurrence of each weekday wins."""

    def test_2026_burn_week_matches_burningman_org(self):
        # Sun Aug 30 → Mon Sep 7, 2026 (burningman.org/…/ticketing-information/)
        m = canonical_week_map("2026-08-30", "2026-09-07")
        self.assertEqual(m, {
            "Sun": "8/30",   # opening Sunday — the closing Sun (9/6)
            "Mon": "8/31",   # is swallowed by first-occurrence-wins
            "Tue": "9/1",
            "Wed": "9/2",
            "Thu": "9/3",
            "Fri": "9/4",
            "Sat": "9/5",
        })

    def test_single_day_window(self):
        m = canonical_week_map("2026-08-30", "2026-08-30")
        self.assertEqual(m, {"Sun": "8/30"})

    def test_rejects_inverted_window(self):
        with self.assertRaises(ValueError):
            canonical_week_map("2026-09-07", "2026-08-30")

    def test_covers_all_seven_days_when_window_is_week(self):
        m = canonical_week_map("2026-08-24", "2026-08-30")  # Mon → Sun
        self.assertEqual(set(m.keys()),
                         {"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"})

    def test_first_occurrence_wins_when_week_wraps(self):
        # A window longer than 7 days surfaces the same weekday twice;
        # earlier one wins (matches how _normalize_day collapses Sun2→Sun).
        m = canonical_week_map("2026-08-30", "2026-09-07")
        self.assertEqual(m["Mon"], "8/31")  # not 9/7


class EffectiveBurnStartTests(unittest.TestCase):
    """The calendar's left edge comes from the corpus, not the config —
    volunteers + early crews run events before gates, and those show up
    in the directory with dates like (8/26)."""

    CFG_START = "2026-08-30"
    CFG_END = "2026-09-07"

    def test_returns_configured_when_no_events(self):
        self.assertEqual(
            effective_burn_start([], self.CFG_START, self.CFG_END),
            self.CFG_START,
        )

    def test_returns_configured_when_events_have_no_dates(self):
        # Recurring events have no start_date; don't contribute.
        parses = [parse_event_time("From 11:00 AM to 3:00 PM on Mon, Tue")]
        self.assertEqual(
            effective_burn_start(parses, self.CFG_START, self.CFG_END),
            self.CFG_START,
        )

    def test_picks_earliest_event_date_in_configured_year(self):
        # Earliest fetched date is 8/25; 2026-08-25 is a Tuesday —
        # pre-gates by 5 days. The window should start there.
        parses = [
            parse_event_time("Begins Tue (8/25) at 6:00 PM, Ends 7:30 PM"),
            parse_event_time("Begins Wed (8/26) at 10:00 AM, Ends 11:00 AM"),
            parse_event_time("Begins Thu (8/27) at 2:00 PM, Ends 3:00 PM"),
        ]
        self.assertEqual(
            effective_burn_start(parses, self.CFG_START, self.CFG_END),
            "2026-08-25",
        )

    def test_earlier_events_push_window_earlier_than_configured(self):
        # Config says 8/30; fetched event on 8/24 (volunteer-week).
        # Effective window must start on 8/24, not 8/30.
        parses = [parse_event_time("Begins Mon (8/24) at 9:00 AM, Ends 11:00 AM")]
        self.assertEqual(
            effective_burn_start(parses, self.CFG_START, self.CFG_END),
            "2026-08-24",
        )

    def test_events_entirely_after_burn_end_fall_back(self):
        # Corpus dates are 10/15 — clearly out of phase with 2026's
        # Aug–Sep window. Ignore and use configured start.
        parses = [parse_event_time("Begins Thu (10/15) at 9:00 AM, Ends 11:00 AM")]
        self.assertEqual(
            effective_burn_start(parses, self.CFG_START, self.CFG_END),
            self.CFG_START,
        )

    def test_malformed_date_ignored(self):
        # Inject a broken parse manually — parse_event_time wouldn't
        # produce this, but be defensive.
        parses = [{"kind": "single", "start_date": "banana", "start_day": "Mon"}]
        self.assertEqual(
            effective_burn_start(parses, self.CFG_START, self.CFG_END),
            self.CFG_START,
        )


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
