"""Check preview inputs, isolation, dependency references and deletion policies.

Runs locally without Kubernetes or AWS credentials.
"""

import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[3]


def render(**arguments):
    command = ["mise", "exec", "--", "jsonnet"]
    for name, value in arguments.items():
        command += ["--tla-str", f"{name}={value}"]
    command += ["deploy/preview/main.jsonnet"]
    return subprocess.run(command, cwd=ROOT, capture_output=True, text=True)


def resources(**arguments):
    result = render(**arguments)
    if result.returncode:
        raise AssertionError(result.stderr)
    return {resource["kind"]: resource for resource in json.loads(result.stdout)}


class PreviewRendering(unittest.TestCase):
    def test_preview_isolation_and_references(self):
        first = resources(prNumber="123")
        second = resources(prNumber="124")
        self.assertEqual(len(first), 5)
        self.assertEqual({r["metadata"]["namespace"] for r in first.values()}, {"skjera-pr-123"})
        self.assertEqual({r["metadata"]["namespace"] for r in second.values()}, {"skjera-pr-124"})
        bucket_name = lambda r: r["Bucket"]["metadata"]["annotations"]["crossplane.io/external-name"]
        self.assertNotEqual(bucket_name(first), bucket_name(second))
        self.assertEqual(bucket_name(first), "skjera-dev-app-440027025698-pr-123-images")
        self.assertEqual(first["Database"]["spec"]["cluster"]["name"], first["Cluster"]["metadata"]["name"])
        for kind in ["BucketPublicAccessBlock", "BucketServerSideEncryptionConfiguration"]:
            self.assertEqual(first[kind]["spec"]["forProvider"]["bucketRef"]["name"], first["Bucket"]["metadata"]["name"])

    def test_overrides_and_cleanup_contract(self):
        items = resources(prNumber="42", namespace="custom-preview", environment="test",
                          awsAccountId="123456789012", awsRegion="eu-west-1", postgresStorageSize="1Gi")
        self.assertEqual({r["metadata"]["namespace"] for r in items.values()}, {"custom-preview"})
        self.assertEqual(items["Cluster"]["spec"]["storage"]["size"], "1Gi")
        self.assertEqual(items["Bucket"]["metadata"]["annotations"]["crossplane.io/external-name"],
                         "skjera-test-app-123456789012-pr-42-images")
        self.assertTrue(items["Bucket"]["spec"]["forProvider"]["forceDestroy"])
        self.assertIn("*", items["Bucket"]["spec"]["managementPolicies"])
        self.assertEqual(items["Database"]["spec"]["databaseReclaimPolicy"], "delete")
        for kind in ["Bucket", "BucketPublicAccessBlock", "BucketServerSideEncryptionConfiguration"]:
            self.assertEqual(items[kind]["spec"]["forProvider"]["region"], "eu-west-1")
        for kind in ["Bucket", "Cluster"]:
            self.assertEqual(items[kind]["metadata"]["annotations"]["argocd.argoproj.io/sync-wave"], "-20")
        for kind in ["Database", "BucketPublicAccessBlock", "BucketServerSideEncryptionConfiguration"]:
            self.assertEqual(items[kind]["metadata"]["annotations"]["argocd.argoproj.io/sync-wave"], "-10")

    def test_invalid_inputs_are_rejected(self):
        cases = [{"prNumber": value} for value in ["", "0", "01", "-1", "1/2", "abc", "1234567890"]]
        cases += [{"prNumber": "1", "namespace": value} for value in ["", "Upper", "bad/name", "-bad", "bad-", "a" * 64]]
        cases += [
            {"prNumber": "1", "awsAccountId": "123"},
            {"prNumber": "1", "awsAccountId": "12345678901x"},
            {"prNumber": "1", "environment": "Bad"},
            {"prNumber": "1", "awsRegion": ""},
            {"prNumber": "1", "postgresStorageSize": ""},
        ]
        for case in cases:
            with self.subTest(case=case):
                self.assertNotEqual(render(**case).returncode, 0)
        result = subprocess.run(["mise", "exec", "--", "jsonnet", "deploy/preview/main.jsonnet"],
                                cwd=ROOT, capture_output=True)
        self.assertNotEqual(result.returncode, 0, "Rendering must require an explicit PR number")


if __name__ == "__main__":
    unittest.main()
