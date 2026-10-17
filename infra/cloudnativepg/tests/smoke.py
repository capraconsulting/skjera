"""Verify a disposable CNPG cluster, pg_automerge, and EBS cleanup.

Run from the repository root with the trusted AWS login active. This test
never creates a database through OpenTofu and never prints database passwords.
Failed tests preserve their namespace for diagnosis.
"""

import json
from pathlib import Path
import secrets
import subprocess
import tempfile


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


settings = json.loads(Path("infra/cloudnativepg/bootstrap.auto.tfvars.json").read_text())
identity = json.loads(subprocess.check_output(["aws", "sts", "get-caller-identity"]))
assert identity["Account"] == settings["aws_account_id"], "Wrong AWS account"
namespace = f"cnpg-smoke-{secrets.token_hex(4)}"
print(f"Testing disposable PostgreSQL in namespace {namespace}", flush=True)

with tempfile.TemporaryDirectory(prefix="skjera-cnpg-smoke-") as directory:
    kubeconfig = str(Path(directory) / "kubeconfig")
    run(["aws", "eks", "update-kubeconfig", "--region", settings["aws_region"],
         "--name", f"skjera-{settings['environment']}", "--kubeconfig", kubeconfig],
        stdout=subprocess.DEVNULL)
    k = ["mise", "exec", "kubectl@1.35", "--", "kubectl", "--kubeconfig", kubeconfig]
    rendered = json.loads(subprocess.check_output([
        "mise", "exec", "--", "jsonnet",
        "--tla-str", f"prNumber={secrets.randbelow(900000000) + 100000000}",
        "--tla-str", f"namespace={namespace}",
        "--tla-str", f"awsAccountId={settings['aws_account_id']}",
        "--tla-str", f"environment={settings['environment']}",
        "--tla-str", f"awsRegion={settings['aws_region']}",
        "--tla-str", "postgresStorageSize=1Gi",
        "deploy/preview/main.jsonnet",
    ]))
    manifests = json.dumps({
        "apiVersion": "v1", "kind": "List",
        "items": [resource for resource in rendered if resource["apiVersion"] == "postgresql.cnpg.io/v1"],
    }).encode()
    run(k + ["create", "namespace", namespace])
    try:
        run(k + ["apply", "--dry-run=server", "-f", "-"], input=manifests)
        run(k + ["apply", "-f", "-"], input=manifests)
        run(k + ["-n", namespace, "wait", "cluster.postgresql.cnpg.io/postgres",
                 "--for=condition=Ready", "--timeout=900s"])
        run(k + ["-n", namespace, "wait", "database.postgresql.cnpg.io/postgres-app",
                 "--for=jsonpath={.status.applied}=true", "--timeout=300s"])
        cluster = json.loads(subprocess.check_output(k + ["-n", namespace, "get",
                             "cluster.postgresql.cnpg.io", "postgres", "-o", "json"]))
        primary = cluster["status"]["currentPrimary"]
        pod = json.loads(subprocess.check_output(k + ["-n", namespace, "get", "pod", primary, "-o", "json"]))
        assert any(volume.get("image") for volume in pod["spec"]["volumes"]), "Extension image volume missing"
        sql = """
SET ROLE skjera;
CREATE EXTENSION IF NOT EXISTS pg_automerge;
SELECT extversion FROM pg_extension WHERE extname = 'pg_automerge';
CREATE TABLE smoke (id uuid DEFAULT uuidv7() PRIMARY KEY, document automerge);
INSERT INTO smoke DEFAULT VALUES;
SELECT count(*) FROM smoke;
SELECT count(*) >= 0 FROM automerge_memory_usage();
DROP TABLE smoke;
"""
        result = subprocess.check_output(k + ["-n", namespace, "exec", "-i", primary,
                         "-c", "postgres", "--", "psql", "-U", "postgres", "-d", "skjera",
                         "-At", "-v", "ON_ERROR_STOP=1"], input=sql.encode()).decode()
        assert "0.1.0" in result and "\nt\n" in result, result
        print("SQL passed as the app role: PostgreSQL 18, pg_automerge 0.1.0 and native library loading.", flush=True)
        run(k + ["-n", namespace, "get", "secret", "postgres-app", "-o", "name"])
        pvcs = json.loads(subprocess.check_output(k + ["-n", namespace, "get", "pvc", "-o", "json"]))["items"]
        volumes = []
        for pvc in pvcs:
            name = pvc["status"]["phase"]
            assert name == "Bound", "PVC not bound"
            pv_name = pvc["spec"]["volumeName"]
            pv = json.loads(subprocess.check_output(k + ["get", "pv", pv_name, "-o", "json"]))
            assert pv["spec"]["persistentVolumeReclaimPolicy"] == "Delete"
            volumes.append((pv_name, pv["spec"]["csi"]["volumeHandle"]))
        # Remove Database before Cluster, matching Argo CD reverse sync-wave order.
        run(k + ["-n", namespace, "delete", "database.postgresql.cnpg.io/postgres-app", "--timeout=180s"])
        run(k + ["-n", namespace, "delete", "cluster.postgresql.cnpg.io/postgres", "--timeout=300s"])
        for pv_name, volume_id in volumes:
            run(k + ["wait", f"pv/{pv_name}", "--for=delete", "--timeout=300s"])
            absent = subprocess.run(["aws", "ec2", "describe-volumes", "--region", settings["aws_region"],
                                     "--volume-ids", volume_id], capture_output=True, text=True)
            assert absent.returncode != 0 and "InvalidVolume.NotFound" in absent.stderr, "EBS deletion not confirmed"
        run(k + ["delete", "namespace", namespace, "--timeout=180s"])
        print("PASS: CNPG created PostgreSQL with pg_automerge; preview database, PVC and EBS volume were deleted.", flush=True)
    except Exception:
        print(f"Test failed; inspect namespace {namespace} before cleaning up.", flush=True)
        subprocess.run(k + ["-n", namespace, "get", "clusters,databases,pods,pvc"])
        raise
