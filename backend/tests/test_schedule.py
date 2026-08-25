"""Tests for reviewed windows and year-safe occurrence formatting."""
import unittest
from unittest import mock

from playa.schedule import (
    ANNUAL_EVENT_WINDOWS,
    WEEK_ORDER,
    _compact_days,
    _to_12h,
    date_in_window,
    date_in_year,
    event_window_for_year,
    format_schedule_display,
)


class AnnualEventWindowTests(unittest.TestCase):
    def test_reviewed_official_windows(self):
        self.assertEqual(
            event_window_for_year(2025),
            ("2025-08-24", "2025-09-01"),
        )
        self.assertEqual(
            event_window_for_year(2026),
            ("2026-08-30", "2026-09-07"),
        )

    def test_unknown_year_is_never_inferred(self):
        with self.assertRaisesRegex(ValueError, "no reviewed official"):
            event_window_for_year(2027)

    def test_reviewed_window_cannot_cross_its_source_year(self):
        with mock.patch.dict(
            ANNUAL_EVENT_WINDOWS,
            {2027: ("2027-12-31", "2028-01-01")},
        ):
            with self.assertRaisesRegex(ValueError, "stay inside that year"):
                event_window_for_year(2027)


class TimeDisplayTests(unittest.TestCase):
    def test_24h_to_12h(self):
        self.assertEqual(_to_12h("00:00"), "12:00 AM")
        self.assertEqual(_to_12h("12:00"), "12:00 PM")
        self.assertEqual(_to_12h("23:59"), "11:59 PM")

    def test_compacts_days(self):
        self.assertEqual(_compact_days(["Mon", "Tue", "Wed"]), "Mon–Wed")
        self.assertEqual(_compact_days(list(WEEK_ORDER)), "Daily")
        self.assertEqual(_compact_days(["Tue", "Thu"]), "Tue, Thu")

    def test_formats_single_and_overnight_occurrences(self):
        single = {
            "dates": ["2026-09-06"],
            "start_time": "10:00", "end_time": "11:00",
            "overnight": False,
        }
        overnight = {
            "dates": ["2026-09-06"],
            "start_time": "23:00", "end_time": "01:00",
            "overnight": True,
        }
        self.assertEqual(
            format_schedule_display(single),
            "Sun 9/6 · 10:00 AM – 11:00 AM",
        )
        self.assertEqual(
            format_schedule_display(overnight),
            "Sun 9/6 11:00 PM – Mon 9/7 1:00 AM",
        )

    def test_formats_recurring_exact_dates(self):
        parsed = {
            "dates": ["2026-08-30", "2026-09-06"],
            "start_time": "12:00", "end_time": "13:00",
            "overnight": False,
        }
        self.assertEqual(
            format_schedule_display(parsed),
            "Sun · 12:00 PM – 1:00 PM",
        )

    def test_empty_dates_have_no_schedule_display(self):
        self.assertIsNone(format_schedule_display(None))
        self.assertIsNone(format_schedule_display({"dates": []}))


class DateBoundaryTests(unittest.TestCase):
    def test_date_must_belong_to_source_year(self):
        self.assertTrue(date_in_year("2026-09-06", 2026))
        self.assertFalse(date_in_year("2025-09-06", 2026))
        self.assertFalse(date_in_year("not-a-date", 2026))

    def test_window_requires_one_matching_year(self):
        self.assertTrue(
            date_in_window("2026-09-06", "2026-08-30", "2026-09-07")
        )
        self.assertFalse(
            date_in_window("2025-09-06", "2026-08-30", "2026-09-07")
        )
        self.assertFalse(
            date_in_window("2026-12-31", "2026-12-31", "2027-01-01")
        )


if __name__ == "__main__":
    unittest.main()
