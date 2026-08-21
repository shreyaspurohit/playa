from datetime import date
import unittest

from scripts.site_unlock_window import boundary_override, unlock_state


class SiteUnlockWindowTests(unittest.TestCase):
    def test_half_open_window(self):
        start = "2026-08-23"
        end = "2026-09-08"
        self.assertEqual(unlock_state(date(2026, 8, 22), start, end), "closed")
        self.assertEqual(unlock_state(date(2026, 8, 23), start, end), "open")
        self.assertEqual(unlock_state(date(2026, 9, 7), start, end), "open")
        self.assertEqual(unlock_state(date(2026, 9, 8), start, end), "closed")

    def test_only_boundaries_request_a_scheduled_deploy(self):
        start = "2026-08-23"
        end = "2026-09-08"
        self.assertEqual(
            boundary_override(date(2026, 8, 23), start, end), "force-open"
        )
        self.assertEqual(
            boundary_override(date(2026, 9, 8), start, end), "force-closed"
        )
        self.assertEqual(boundary_override(date(2026, 8, 24), start, end), "")

    def test_unset_window_stays_closed_and_never_schedules(self):
        today = date(2026, 8, 23)
        self.assertEqual(unlock_state(today, "", ""), "closed")
        self.assertEqual(boundary_override(today, "", ""), "")

    def test_partial_invalid_and_inverted_windows_fail(self):
        today = date(2026, 8, 23)
        with self.assertRaisesRegex(ValueError, "both be set"):
            unlock_state(today, "2026-08-23", "")
        with self.assertRaisesRegex(ValueError, "valid YYYY-MM-DD"):
            unlock_state(today, "2026-02-30", "2026-09-08")
        with self.assertRaisesRegex(ValueError, "must be before"):
            unlock_state(today, "2026-09-08", "2026-09-08")


if __name__ == "__main__":
    unittest.main()
