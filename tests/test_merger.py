"""Unit tests for bm_camps.merger."""
import contextlib
import csv
import io
import json
import tempfile
import unittest
from pathlib import Path

from bm_camps.config import Config
from bm_camps.merger import FIELDS, merge_csv


class MergeCsvTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.config = Config(root=Path(self.tmp.name))
        self.config.pages_dir.mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def _write_page(self, n, camps):
        (self.config.pages_dir / f"page_{n:02d}.json").write_text(json.dumps(camps))

    def _run(self):
        with contextlib.redirect_stdout(io.StringIO()):
            merge_csv(self.config)

    def _read(self):
        with self.config.camps_csv.open(newline="") as fh:
            return list(csv.DictReader(fh))

    def test_header_columns_in_order(self):
        self._write_page(1, [{"id": "1", "name": "A", "location": "",
                              "description": "", "website": ""}])
        self._run()
        with self.config.camps_csv.open() as fh:
            header = fh.readline().strip()
        self.assertEqual(header, ",".join(FIELDS))

    def test_merges_across_pages_and_sorts_alphabetically(self):
        self._write_page(1, [
            {"id": "1", "name": "Zebra", "location": "A", "description": "z", "website": ""},
            {"id": "2", "name": "Apple", "location": "B", "description": "a", "website": "http://x"},
        ])
        self._write_page(2, [
            {"id": "3", "name": "Banana", "location": "C", "description": "b", "website": ""},
        ])
        self._run()
        rows = self._read()
        self.assertEqual([r["camp_name"] for r in rows], ["Apple", "Banana", "Zebra"])

    def test_dedupes_by_id(self):
        shared = {"id": "42", "name": "Dupe", "location": "X",
                  "description": "once", "website": ""}
        self._write_page(1, [shared])
        self._write_page(2, [shared])
        self._run()
        self.assertEqual(len(self._read()), 1)

    def test_tags_column_blank(self):
        self._write_page(1, [{"id": "1", "name": "A", "location": "",
                              "description": "", "website": ""}])
        self._run()
        self.assertEqual(self._read()[0]["tags"], "")

    def test_website_preserved(self):
        self._write_page(1, [{"id": "1", "name": "A", "location": "",
                              "description": "", "website": "http://example.com"}])
        self._run()
        self.assertEqual(self._read()[0]["website"], "http://example.com")

    def test_handles_missing_website_field(self):
        # Legacy page JSONs that predate website field.
        self._write_page(1, [{"id": "1", "name": "A", "location": "",
                              "description": ""}])
        self._run()
        self.assertEqual(self._read()[0]["website"], "")


if __name__ == "__main__":
    unittest.main()
