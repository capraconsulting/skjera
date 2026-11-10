import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cleanup_images import closed_tags
from github import validate
from reconcile import candidates, reconcile, remove_closed, update

IMAGE = "440027025698.dkr.ecr.eu-north-1.amazonaws.com/skjera-dev@sha256:" + "a" * 64


def fixture():
    metadata = {"prNumber": "123", "image": IMAGE, "headSha": "b" * 40,
                "runId": "100", "runAttempt": "1"}
    run = {"id": 100, "run_attempt": 1, "event": "pull_request", "conclusion": "success",
           "head_branch": "feature", "head_sha": "b" * 40,
           "head_repository": {"full_name": "capraconsulting/skjera"},
           "actor": {"login": "TheKnarf"}}
    pr = {"number": 123, "state": "open", "user": {"login": "TheKnarf"},
          "head": {"ref": "feature", "sha": "b" * 40,
                   "repo": {"full_name": "capraconsulting/skjera"}}}
    return metadata, run, pr


class ArtifactValidation(unittest.TestCase):
    def test_current_build_is_accepted_and_stale_head_is_skipped(self):
        metadata, run, pr = fixture()
        self.assertTrue(validate(metadata, run, pr))
        pr["head"]["sha"] = "c" * 40
        self.assertFalse(validate(metadata, run, pr))

    def test_closed_fork_deleted_repo_and_dependabot_are_skipped(self):
        for change in [lambda p: p.update(state="closed"),
                       lambda p: p["head"].update(repo={"full_name": "someone/fork"}),
                       lambda p: p["head"].update(repo=None),
                       lambda p: p["user"].update(login="dependabot[bot]")]:
            metadata, run, pr = fixture()
            change(pr)
            self.assertFalse(validate(metadata, run, pr))

    def test_forged_metadata_and_untrusted_builds_are_rejected(self):
        mutations = [lambda m, r: m.update(image="attacker/image@sha256:" + "a" * 64),
                     lambda m, r: m.update(image=IMAGE + "\nmalicious=value"),
                     lambda m, r: m.update(prNumber="../../bad"),
                     lambda m, r: m.update(runId="99"),
                     lambda m, r: m.update(runAttempt="2"),
                     lambda m, r: m.update(headSha="d" * 40),
                     lambda m, r: r.update(head_branch="other-pr"),
                     lambda m, r: r.update(event="pull_request_target"),
                     lambda m, r: r.update(conclusion="failure"),
                     lambda m, r: r["head_repository"].update(full_name="attacker/fork"),
                     lambda m, r: r["actor"].update(login="dependabot[bot]")]
        for mutation in mutations:
            metadata, run, pr = fixture()
            mutation(metadata, run)
            with self.subTest(metadata=metadata, run=run), self.assertRaises(ValueError):
                validate(metadata, run, pr)


class DesiredState(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "previews").mkdir()
        (self.root / "templates/preview").mkdir(parents=True)
        (self.root / "templates/preview/main.jsonnet").write_text("[]")

    def tearDown(self):
        self.temp.cleanup()

    def test_newer_run_cannot_be_overwritten_and_updates_keep_secrets(self):
        metadata, run, pr = fixture()
        with patch("reconcile.ensure_secret") as seal:
            self.assertEqual(update(self.root, metadata, run, pr), metadata)
            seal.assert_called_once()
        config = self.root / "previews/pr-123/config.json"
        newer = {**metadata, "runId": "101"}
        config.write_text(json.dumps(newer))
        with patch("reconcile.ensure_secret") as seal:
            self.assertIsNone(update(self.root, metadata, run, pr))
            seal.assert_not_called()
        self.assertEqual(json.loads(config.read_text()), newer)

    def test_close_removes_only_closed_preview_and_api_errors_fail_closed(self):
        for number in [123, 124]:
            (self.root / f"previews/pr-{number}").mkdir()
        remove_closed(self.root, lambda number: {**fixture()[2], "state": "closed" if number == "123" else "open"})
        self.assertFalse((self.root / "previews/pr-123").exists())
        self.assertTrue((self.root / "previews/pr-124").exists())
        with self.assertRaises(RuntimeError):
            remove_closed(self.root, lambda _: (_ for _ in ()).throw(RuntimeError("API failed")))
        self.assertTrue((self.root / "previews/pr-124").exists())

    def test_symlinks_and_unexpected_directories_are_rejected(self):
        for name in ["production", "pr-001"]:
            target = self.root / "previews" / name
            target.mkdir()
            with self.assertRaises(ValueError):
                remove_closed(self.root, lambda _: fixture()[2])
            target.rmdir()
        (self.root / "previews/pr-123").symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            remove_closed(self.root, lambda _: fixture()[2])

    def test_pr_closing_during_secret_creation_is_not_recreated(self):
        metadata, run, pr = fixture()
        def seal(*_):
            pr["state"] = "closed"
        with patch("reconcile.candidates", return_value=[(metadata, run)]), \
                patch("reconcile.api", side_effect=lambda _: copy.deepcopy(pr)), \
                patch("reconcile.ensure_secret", side_effect=seal):
            self.assertIsNone(reconcile(self.root, {}, push=False))
        self.assertFalse((self.root / "previews/pr-123").exists())

    def test_schedule_backfills_missed_successful_builds(self):
        metadata, run, pr = fixture()
        with patch("reconcile.pages", return_value=[pr]), \
                patch("reconcile.api", return_value={"workflow_runs": [run]}), \
                patch("reconcile.image_artifact", return_value=metadata):
            self.assertEqual(candidates({}, self.root), [(metadata, run)])
        self.assertEqual(candidates({"pull_request": pr}, self.root), [])

    def test_local_reconciliation_can_commit_and_push_without_force(self):
        remote = self.root / "remote.git"
        subprocess.run(["git", "init", "--bare", str(remote)], check=True, capture_output=True)
        def git(*args):
            return subprocess.run(["git", "-C", str(self.root), *args], check=True, capture_output=True, text=True)
        git("init", "-b", "main")
        git("config", "user.name", "Test")
        git("config", "user.email", "test@example.invalid")
        git("add", "templates")
        git("commit", "-m", "Initial templates")
        git("remote", "add", "origin", str(remote))
        git("push", "origin", "main")
        metadata, run, pr = fixture()
        with patch("reconcile.candidates", return_value=[(metadata, run)]), \
                patch("reconcile.api", return_value=pr), patch("reconcile.ensure_secret"):
            reconcile(self.root, {}, push=True)
            first = git("rev-parse", "HEAD").stdout
            reconcile(self.root, {}, push=True)
            self.assertEqual(git("rev-parse", "HEAD").stdout, first)
        self.assertEqual(git("rev-parse", "HEAD").stdout, git("rev-parse", "origin/main").stdout)


class ImageCleanup(unittest.TestCase):
    def test_only_closed_pr_tags_are_removed(self):
        suffix = "-sha-" + "f" * 40 + "-100-1"
        images = [{"imageTags": ["main" + suffix, "pr-123" + suffix, "pr-124" + suffix,
                                 "sha-legacy", "pr-001" + suffix]}, {}]
        self.assertEqual(closed_tags(images, lambda pr: {"state": "closed" if pr == "123" else "open"}),
                         [{"imageTag": "pr-123" + suffix}])


if __name__ == "__main__":
    unittest.main()
