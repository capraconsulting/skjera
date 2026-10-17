"""Create/upload/delete disposable storage through Crossplane, never OpenTofu.

Run from the repository root, with the trusted Capra AWS login active.
On failure, preserve the namespace for diagnosis and finish cleanup through
Crossplane; never bypass its finalizers.
"""

import json
from pathlib import Path
import secrets
import subprocess
import tempfile


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


settings = json.loads(Path("infra/crossplane/bootstrap.auto.tfvars.json").read_text())
identity = json.loads(subprocess.check_output(["aws", "sts", "get-caller-identity"]))
assert identity["Account"] == settings["aws_account_id"], "Wrong AWS account"
preview = f"pr-{secrets.randbelow(900000000) + 100000000}"
namespace = f"crossplane-smoke-{preview}"
bucket = f"skjera-{settings['environment']}-app-{settings['aws_account_id']}-{preview}-images"
print(f"Testing namespace {namespace} and disposable bucket {bucket}", flush=True)

with tempfile.TemporaryDirectory(prefix="skjera-crossplane-smoke-") as directory:
    kubeconfig = str(Path(directory) / "kubeconfig")
    run(["aws", "eks", "update-kubeconfig", "--region", settings["aws_region"],
         "--name", f"skjera-{settings['environment']}", "--kubeconfig", kubeconfig],
        stdout=subprocess.DEVNULL)
    kubectl = ["mise", "exec", "kubectl@1.35", "--", "kubectl", "--kubeconfig", kubeconfig]
    rendered = json.loads(subprocess.check_output([
        "mise", "exec", "--", "jsonnet",
        "--tla-str", f"prNumber={preview[3:]}",
        "--tla-str", f"namespace={namespace}",
        "--tla-str", f"awsAccountId={settings['aws_account_id']}",
        "--tla-str", f"environment={settings['environment']}",
        "--tla-str", f"awsRegion={settings['aws_region']}",
        "deploy/preview/main.jsonnet",
    ]))
    manifests = json.dumps({
        "apiVersion": "v1", "kind": "List",
        "items": [resource for resource in rendered if resource["apiVersion"] == "s3.aws.m.upbound.io/v1beta1"],
    }).encode()
    run(kubectl + ["create", "namespace", namespace])
    try:
        run(kubectl + ["apply", "--dry-run=server", "-f", "-"], input=manifests)
        run(kubectl + ["apply", "-f", "-"], input=manifests)
        resources = ["bucket.s3.aws.m.upbound.io/images",
                     "bucketpublicaccessblock.s3.aws.m.upbound.io/images",
                     "bucketserversideencryptionconfiguration.s3.aws.m.upbound.io/images"]
        for condition in ["Ready", "Synced"]:
            run(kubectl + ["-n", namespace, "wait", *resources,
                           f"--for=condition={condition}", "--timeout=300s"])
        content = Path(directory) / "upload.txt"
        content.write_text("Crossplane preview cleanup smoke test\n")
        run(["aws", "s3api", "put-object", "--region", settings["aws_region"],
             "--bucket", bucket, "--key", "smoke/upload.txt", "--body", str(content)],
            stdout=subprocess.DEVNULL)
        print("Uploaded an object; Crossplane must empty the bucket during deletion.", flush=True)
        run(kubectl + ["-n", namespace, "delete", *resources[1:], "--wait=true", "--timeout=180s"])
        run(kubectl + ["-n", namespace, "delete", resources[0], "--wait=true", "--timeout=300s"])
        absent = subprocess.run(["aws", "s3api", "head-bucket", "--region", settings["aws_region"],
                                 "--bucket", bucket], capture_output=True, text=True)
        assert absent.returncode != 0 and "(404)" in absent.stderr, "Bucket deletion not confirmed"
        run(kubectl + ["delete", "namespace", namespace, "--timeout=120s"])
        print("PASS: Crossplane created the bucket and deleted it with its uploaded object.", flush=True)
    except Exception:
        print(f"Test failed; inspect namespace {namespace} and bucket {bucket}.", flush=True)
        subprocess.run(kubectl + ["-n", namespace, "get", "managed", "-o", "wide"])
        raise
