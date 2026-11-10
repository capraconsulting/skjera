import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import deployments
import wait
from test_reconcile import fixture


class DeploymentLinks(unittest.TestCase):
    def setUp(self):
        self.pr = fixture()[2]
        self.deployment = {"id": 42, "environment": "pr-123", "sha": "b" * 40}
        self.env = patch.dict(os.environ, {"GITHUB_RUN_ID": "100"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_creates_exact_head_without_merge_or_unrelated_contexts(self):
        with patch("deployments.api", return_value=self.deployment) as api:
            deployments.create("123", "b" * 40)
        payload = api.call_args_list[0].args[1]
        self.assertEqual(payload["ref"], "b" * 40)
        self.assertFalse(payload["auto_merge"])
        self.assertEqual(payload["required_contexts"], [])
        self.assertTrue(payload["transient_environment"])
        self.assertFalse(payload["production_environment"])
        pending = api.call_args_list[1].args[1]
        self.assertEqual(pending["state"], "in_progress")
        self.assertEqual(pending["environment_url"], "https://pr-123.skjera.capraconsulting.no")

    def test_success_only_after_readiness_and_failure_is_reported(self):
        for result in (True, None, TimeoutError("not ready")):
            with self.subTest(result=result), patch("wait.api", return_value=self.pr), \
                    patch("wait.create", return_value=self.deployment), \
                    patch("wait.status") as status, patch("wait.wait_ready") as ready:
                if isinstance(result, Exception):
                    ready.side_effect = result
                    with self.assertRaises(TimeoutError):
                        wait.wait("123", fixture()[0]["image"], "b" * 40)
                    expected = "failure"
                else:
                    ready.return_value = result
                    wait.wait("123", fixture()[0]["image"], "b" * 40)
                    expected = "success" if result else "inactive"
                self.assertEqual(status.call_args.args[1], expected)

    def test_stale_revision_does_not_create_a_deployment(self):
        with patch("wait.api", return_value=self.pr), patch("wait.create") as create:
            wait.wait("123", fixture()[0]["image"], "c" * 40)
            create.assert_not_called()

    def test_close_and_superseded_cleanup_is_idempotent(self):
        for closed, sha, previous, expected in [
            (False, "b" * 40, "success", False),
            (True, "b" * 40, "success", True),
            (False, "c" * 40, "in_progress", True),
            (True, "b" * 40, "inactive", False),
        ]:
            pr = {**self.pr, "state": "closed" if closed else "open"}
            deployment = {**self.deployment, "sha": sha}
            def api(path):
                return [{"state": previous}] if "/statuses" in path else pr
            with self.subTest(closed=closed, sha=sha, previous=previous), \
                    patch("deployments.pages", return_value=[deployment]), \
                    patch("deployments.api", side_effect=api), patch("deployments.status") as status:
                deployments.retire_closed()
                self.assertEqual(status.called, expected)
                if expected:
                    self.assertEqual(status.call_args.args[1], "inactive")

    def test_lookup_errors_do_not_mark_deployments_inactive(self):
        with patch("deployments.pages", return_value=[self.deployment]), \
                patch("deployments.api", side_effect=RuntimeError("GitHub unavailable")), \
                patch("deployments.status") as status:
            with self.assertRaises(RuntimeError):
                deployments.retire_closed()
            status.assert_not_called()


if __name__ == "__main__":
    unittest.main()
