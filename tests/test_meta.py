"""Unit tests for bm_camps.meta."""
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from bm_camps.config import Config
from bm_camps.meta import write_meta


class WriteMetaTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.config = Config(root=Path(self.tmp.name))
        self.config.pages_dir.mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def _run(self) -> dict:
        with contextlib.redirect_stdout(io.StringIO()):
            write_meta(self.config)
        return json.loads(self.config.meta_file.read_text())

    def test_counts_camps_and_events_across_pages(self):
        (self.config.pages_dir / "page_01.json").write_text(json.dumps([
            {"id": "1", "name": "A", "events": [{"id": "e1"}, {"id": "e2"}]},
            {"id": "2", "name": "B", "events": []},
        ]))
        (self.config.pages_dir / "page_02.json").write_text(json.dumps([
            {"id": "3", "name": "C", "events": [{"id": "e3"}]},
        ]))
        meta = self._run()
        self.assertEqual(meta["camps"], 3)
        self.assertEqual(meta["events"], 3)
        self.assertEqual(meta["pages"], 2)

    def test_timestamp_format(self):
        (self.config.pages_dir / "page_01.json").write_text("[]")
        meta = self._run()
        self.assertRegex(meta["scraped_at"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
        self.assertRegex(meta["scraped_date"], r"^\d{4}-\d{2}-\d{2}$")
        self.assertRegex(meta["version"], r"^v\d{4}\.\d{2}\.\d{2}$")

    def test_version_matches_date(self):
        (self.config.pages_dir / "page_01.json").write_text("[]")
        meta = self._run()
        self.assertEqual(meta["version"],
                         "v" + meta["scraped_date"].replace("-", "."))

    def test_handles_missing_events_field(self):
        (self.config.pages_dir / "page_01.json").write_text(json.dumps([
            {"id": "1", "name": "A"},  # no events key
        ]))
        meta = self._run()
        self.assertEqual(meta["camps"], 1)
        self.assertEqual(meta["events"], 0)

    def test_zero_pages_still_writes_valid_meta(self):
        meta = self._run()
        self.assertEqual(meta["camps"], 0)
        self.assertEqual(meta["events"], 0)
        self.assertEqual(meta["pages"], 0)


if __name__ == "__main__":
    unittest.main()
