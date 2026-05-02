"""Tests for the `_collect_release_notes` git-log filter.

We exercise the real `git log` against a tiny temp repo with hand-crafted
commits — easier than mocking subprocess + more honest about format
mismatches that mocks would silently paper over.
"""
import contextlib
import io
import os
import subprocess
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from playa.builder import SiteBuilder
from playa.config import Config
from playa.tagger import Tagger


def _git(repo: Path, *args: str) -> None:
    """Run a git command in the given repo, swallowing output."""
    env = {
        **os.environ,
        # Deterministic + isolated. Important on developer machines
        # where the global config might enable signing or hooks.
        "GIT_AUTHOR_NAME":     "Test",
        "GIT_AUTHOR_EMAIL":    "test@example.com",
        "GIT_COMMITTER_NAME":  "Test",
        "GIT_COMMITTER_EMAIL": "test@example.com",
    }
    subprocess.run(
        ["git", *args],
        cwd=repo,
        env=env,
        check=True,
        capture_output=True,
    )


def _commit(repo: Path, message: str, author_date: str | None = None) -> None:
    """Append a unique line + commit. Optional explicit author date so we
    can verify the order coming out of `_collect_release_notes`."""
    f = repo / "log.txt"
    with f.open("a") as fp:
        fp.write(message + "\n")
    _git(repo, "add", "log.txt")
    env_extra = {}
    if author_date:
        env_extra = {
            "GIT_AUTHOR_DATE":    author_date,
            "GIT_COMMITTER_DATE": author_date,
        }
    subprocess.run(
        ["git", "commit", "-m", message],
        cwd=repo,
        env={**os.environ, **env_extra,
             "GIT_AUTHOR_NAME":  "Test",
             "GIT_AUTHOR_EMAIL": "test@example.com",
             "GIT_COMMITTER_NAME":  "Test",
             "GIT_COMMITTER_EMAIL": "test@example.com"},
        check=True,
        capture_output=True,
    )


class CollectReleaseNotesTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        # Fresh repo, no global hooks.
        _git(self.root, "init", "-q", "-b", "main")
        # Seed commit so future commits don't error on missing HEAD.
        (self.root / "log.txt").write_text("init\n")
        _git(self.root, "add", "log.txt")
        _git(self.root, "commit", "-q", "-m", "chore: initial seed")

        # Test fixture supplies burn dates explicitly — production
        # Config has no defaults (CI repo vars are the source of truth).
        self.config = Config(
            root=self.root,
            burn_start="2026-08-30",
            burn_end="2026-09-07",
        )
        self.config.pages_dir.mkdir(parents=True)
        # Builder needs a Tagger; default taxonomy is fine.
        self.builder = SiteBuilder(self.config, Tagger())

    def tearDown(self):
        self.tmp.cleanup()

    def _collect(self, **kwargs) -> list[dict]:
        with contextlib.redirect_stdout(io.StringIO()):
            return self.builder._collect_release_notes(**kwargs)

    def test_picks_up_only_rn_prefixed_commits(self):
        _commit(self.root, "rn: zoom on the map")
        _commit(self.root, "fix: typo in legend")
        _commit(self.root, "rn: import/export buttons")
        _commit(self.root, "feat: not a release note despite mentioning rn")
        notes = self._collect()
        messages = [n["message"] for n in notes]
        self.assertEqual(sorted(messages),
                         ["import/export buttons", "zoom on the map"])

    def test_orders_oldest_first(self):
        # Author dates are honored by git when explicitly set.
        _commit(self.root, "rn: alpha", author_date="2026-04-01T10:00:00 +0000")
        _commit(self.root, "rn: bravo", author_date="2026-04-02T10:00:00 +0000")
        _commit(self.root, "rn: charlie", author_date="2026-04-03T10:00:00 +0000")
        notes = self._collect()
        self.assertEqual([n["message"] for n in notes],
                         ["alpha", "bravo", "charlie"])

    def test_strips_the_rn_prefix_from_message(self):
        _commit(self.root, "rn:no-space-after-colon")
        _commit(self.root, "rn:   lots-of-spaces-after")
        notes = self._collect()
        # `rn:` + trim — no prefix in the message field.
        for n in notes:
            self.assertFalse(n["message"].startswith("rn:"),
                             f"message still has prefix: {n['message']!r}")

    def test_drops_empty_messages(self):
        _commit(self.root, "rn:")
        _commit(self.root, "rn: ")
        _commit(self.root, "rn: real one")
        notes = self._collect()
        self.assertEqual(len(notes), 1)
        self.assertEqual(notes[0]["message"], "real one")

    def test_each_entry_has_ts_sha_message(self):
        _commit(self.root, "rn: only one")
        notes = self._collect()
        self.assertEqual(len(notes), 1)
        n = notes[0]
        self.assertEqual(set(n.keys()), {"ts", "sha", "message"})
        # ts is an ISO-8601 string (parseable by datetime.fromisoformat
        # for any modern Python; we just sanity-check the prefix).
        self.assertRegex(n["ts"], r"^\d{4}-\d{2}-\d{2}T")
        # sha is short (7 chars) — that's what the builder slices to.
        self.assertEqual(len(n["sha"]), 7)

    def test_respects_limit(self):
        # 5 commits, limit 3 → at most 3 returned.
        for i in range(5):
            _commit(self.root, f"rn: entry {i}")
        notes = self._collect(limit=3)
        self.assertLessEqual(len(notes), 3)

    def test_no_rn_commits_returns_empty_list(self):
        _commit(self.root, "feat: no release notes here")
        _commit(self.root, "fix: also nothing")
        notes = self._collect()
        self.assertEqual(notes, [])

    def test_no_git_dir_returns_empty_list(self):
        # Build a Config rooted at a directory that's not a git repo —
        # the subprocess returncode will be non-zero, which the
        # collector turns into [].
        with tempfile.TemporaryDirectory() as plain_dir:
            cfg = Config(
                root=Path(plain_dir),
                burn_start="2026-08-30",
                burn_end="2026-09-07",
            )
            cfg.pages_dir.mkdir(parents=True)
            builder = SiteBuilder(cfg, Tagger())
            with contextlib.redirect_stdout(io.StringIO()):
                with contextlib.redirect_stderr(io.StringIO()):
                    notes = builder._collect_release_notes()
            self.assertEqual(notes, [])


if __name__ == "__main__":
    unittest.main()
