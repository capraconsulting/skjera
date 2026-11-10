"""Publish, run and remove one disposable Argo CD preview without a Git push.

Secrets are generated in memory/Kubernetes and a mode-0600 local journal.
The OCI repository credential is temporary and removed with the smoke project.
"""

import argparse
import base64
import fcntl
import json
import os
from pathlib import Path
import secrets
import subprocess
import tarfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
LOCAL = ROOT / "deploy/preview/.local"
JOURNAL = LOCAL / "current.json"
SETTINGS = json.loads((ROOT / "infra/common/bootstrap.auto.tfvars.json").read_text())
REGION = SETTINGS["aws_region"]
ACCOUNT = SETTINGS["aws_account_id"]
ENVIRONMENT = SETTINGS["environment"]
REGISTRY = f"{ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com"
REPOSITORY = f"skjera-{ENVIRONMENT}"
IMAGE_REPO = f"{REGISTRY}/{REPOSITORY}"
ORAS = ["mise", "exec", "oras@1.3.6", "--", "oras"]
os.umask(0o077)
os.chdir(ROOT)
LOCAL.mkdir(exist_ok=True)
LOCAL.chmod(0o700)


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def aws(*args):
    output = subprocess.check_output(["aws", *args, "--region", REGION, "--output", "json"])
    return json.loads(output or b"{}")


def save(state):
    JOURNAL.write_text(json.dumps(state, indent=2) + "\n")
    JOURNAL.chmod(0o600)


def load():
    if JOURNAL.exists():
        state = json.loads(JOURNAL.read_text())
        if not state.get("cleaned"):
            return state
    number = str(secrets.randbelow(99_999_999) + 900_000_000)
    state = {
        "pr": number, "namespace": f"skjera-pr-{number}", "run": uuid.uuid4().hex[:12],
        "url": f"https://pr-{number}.skjera.capraconsulting.no",
        "bucket": f"skjera-{ENVIRONMENT}-app-{ACCOUNT}-pr-{number}-images",
        "application": f"skjera-preview-{number}",
    }
    state["imageTag"] = f"preview-smoke-app-{state['run']}"
    state["artifactTag"] = f"preview-smoke-config-{state['run']}"
    save(state)
    return state


def kube():
    assert aws("sts", "get-caller-identity")["Account"] == ACCOUNT, "Wrong AWS account"
    config = LOCAL / "kubeconfig"
    run(["aws", "eks", "update-kubeconfig", "--region", REGION, "--name", f"skjera-{ENVIRONMENT}",
         "--kubeconfig", str(config)], stdout=subprocess.DEVNULL)
    config.chmod(0o600)
    return ["mise", "exec", "kubectl@1.35", "--", "kubectl", "--kubeconfig", str(config)]


def apply(k, resource):
    run(k + ["apply", "-f", "-"], input=json.dumps(resource).encode(), stdout=subprocess.DEVNULL)


def get(k, resource, name=None, namespace=None):
    command = k + (["-n", namespace] if namespace else []) + ["get", resource]
    command += [name] if name else []
    output = subprocess.check_output(command + ["--ignore-not-found", "-o", "json"])
    return json.loads(output or b"{}")


def digest(tag):
    return aws("ecr", "describe-images", "--repository-name", REPOSITORY,
               "--image-ids", f"imageTag={tag}")["imageDetails"][0]["imageDigest"]


def build(state):
    if state.get("built"):
        return
    print("Building the current working tree for linux/amd64; see deploy/preview/.local/build.log", flush=True)
    with (LOCAL / "build.log").open("w") as out:
        run(["docker", "buildx", "build", "--platform", "linux/amd64", "--provenance=false", "--sbom=false",
             "--load", "--tag", f"{IMAGE_REPO}:{state['imageTag']}", "."], stdout=out, stderr=subprocess.STDOUT)
    state["built"] = True
    save(state)


def publish(state):
    assert aws("sts", "get-caller-identity")["Account"] == ACCOUNT
    build(state)
    password = subprocess.check_output(["aws", "ecr", "get-login-password", "--region", REGION])
    docker_config = Path.home() / ".docker/config.json"
    previous_auth = json.loads(docker_config.read_text()).get("auths", {}) if docker_config.exists() else {}
    state.setdefault("dockerWasLoggedIn", REGISTRY in previous_auth)
    save(state)
    run(["docker", "login", "--username", "AWS", "--password-stdin", REGISTRY], input=password,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    with (LOCAL / "push.log").open("w") as out:
        if not state.get("image"):
            run(["docker", "push", f"{IMAGE_REPO}:{state['imageTag']}"], stdout=out, stderr=subprocess.STDOUT)
            state["imageDigest"] = digest(state["imageTag"])
            state["image"] = f"{IMAGE_REPO}@{state['imageDigest']}"
            save(state)
        if not state.get("artifactDigest"):
            package = LOCAL / "manifests.tar.gz"
            with tarfile.open(package, "w:gz") as archive:
                archive.add(ROOT / "deploy/preview/main.jsonnet", arcname="main.jsonnet")
                archive.add(ROOT / "deploy/preview/lib", arcname="lib")
            auth = LOCAL / "registry.json"
            run(ORAS + ["login", "--registry-config", str(auth), "--username", "AWS", "--password-stdin", REGISTRY],
                input=password, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            run(ORAS + ["push", "--registry-config", str(auth), f"{IMAGE_REPO}:{state['artifactTag']}",
                        f"{package.name}:application/vnd.oci.image.layer.v1.tar+gzip"], cwd=LOCAL,
                stdout=out, stderr=subprocess.STDOUT)
            state["artifactDigest"] = digest(state["artifactTag"])
            save(state)
    print("Published app image and immutable Jsonnet OCI artifact", flush=True)


def deploy(state):
    k = kube()
    namespace = state["namespace"]
    existing = get(k, "namespace", namespace)
    if existing:
        assert existing["metadata"].get("labels", {}).get("skjera.capraconsulting.no/smoke-run") == state["run"], "Namespace belongs to another run"
    else:
        resource = {"apiVersion": "v1", "kind": "Namespace", "metadata": {"name": namespace, "labels": {
            "skjera.capraconsulting.no/smoke-run": state["run"], "skjera.capraconsulting.no/preview": "true"}}}
        run(k + ["create", "-f", "-"], input=json.dumps(resource).encode(), stdout=subprocess.DEVNULL)
    if not get(k, "secret", "preview-app", namespace):
        state["password"] = secrets.token_urlsafe(24)
        save(state)
        hashed = subprocess.check_output(["htpasswd", "-niB", "-C", "10", "preview"], input=(state["password"] + "\n").encode()).decode().strip().split(":", 1)[1]
        client_secret = secrets.token_urlsafe(32)
        config = {
            "issuer": state["url"] + "/dex", "storage": {"type": "memory"},
            "web": {"http": "0.0.0.0:5556"}, "telemetry": {"http": "0.0.0.0:5558"},
            "oauth2": {"responseTypes": ["code"], "skipApprovalScreen": True},
            "staticClients": [{"id": "skjera-preview", "secret": client_secret, "name": "Skjera preview",
                               "redirectURIs": [state["url"] + "/auth/callback"]}],
            "enablePasswordDB": True,
            "staticPasswords": [{"email": "alice@example.com", "username": "alice", "userID": str(uuid.uuid4()), "hash": hashed}],
        }
        # Create, rather than apply, so no plaintext last-applied annotation is stored.
        secret = {"apiVersion": "v1", "kind": "Secret", "metadata": {"name": "preview-app", "namespace": namespace},
                  "stringData": {"signing-secret": secrets.token_urlsafe(48), "oidc-client-secret": client_secret, "dex-config": json.dumps(config)}}
        run(k + ["create", "-f", "-"], input=json.dumps(secret).encode(), stdout=subprocess.DEVNULL)
    token = aws("ecr", "get-authorization-token")["authorizationData"][0]["authorizationToken"]
    username, password = base64.b64decode(token).decode().split(":", 1)
    repo_secret = {"apiVersion": "v1", "kind": "Secret", "metadata": {
        "name": state["application"], "namespace": "argocd", "labels": {"argocd.argoproj.io/secret-type": "repository"}},
        "stringData": {"type": "oci", "url": "oci://" + IMAGE_REPO, "username": username, "password": password}}
    # Server-side apply avoids a last-applied annotation containing the registry credential.
    run(k + ["apply", "--server-side", "--field-manager=preview-smoke", "-f", "-"],
        input=json.dumps(repo_secret).encode(), stdout=subprocess.DEVNULL)
    project = {"apiVersion": "argoproj.io/v1alpha1", "kind": "AppProject", "metadata": {"name": state["application"], "namespace": "argocd"},
               "spec": {"sourceRepos": ["oci://" + IMAGE_REPO], "destinations": [{"server": "https://kubernetes.default.svc", "namespace": namespace}],
                        "clusterResourceWhitelist": [{"group": "", "kind": "Namespace"}],
                        "namespaceResourceWhitelist": [{"group": group, "kind": kind} for group, kind in [
                            ("", "Service"), ("", "ServiceAccount"), ("apps", "Deployment"),
                            ("gateway.networking.k8s.io", "HTTPRoute"), ("postgresql.cnpg.io", "Cluster"), ("postgresql.cnpg.io", "Database"),
                            ("eks.aws.m.upbound.io", "PodIdentityAssociation"), ("s3.aws.m.upbound.io", "Bucket"),
                            ("s3.aws.m.upbound.io", "BucketPublicAccessBlock"), ("s3.aws.m.upbound.io", "BucketServerSideEncryptionConfiguration")]]}}
    apply(k, project)
    app = {"apiVersion": "argoproj.io/v1alpha1", "kind": "Application", "metadata": {
        "name": state["application"], "namespace": "argocd", "finalizers": ["resources-finalizer.argocd.argoproj.io"]},
        "spec": {"project": state["application"], "source": {"repoURL": "oci://" + IMAGE_REPO,
                 "targetRevision": state["artifactDigest"], "path": ".", "directory": {"include": "main.jsonnet", "jsonnet": {"tlas": [
                     {"name": "prNumber", "value": state["pr"]}, {"name": "image", "value": state["image"]},
                     {"name": "postgresStorageSize", "value": "1Gi"}]}}},
                 "destination": {"server": "https://kubernetes.default.svc", "namespace": namespace},
                 "syncPolicy": {"automated": {"prune": True, "selfHeal": True}, "syncOptions": ["PruneLast=true"]}}}
    apply(k, app)
    state["deployed"] = True
    save(state)
    print("Argo CD is deploying " + state["url"], flush=True)


def wait(state):
    k = kube()
    deadline = time.monotonic() + 1500
    previous = None
    while time.monotonic() < deadline:
        app = get(k, "application", state["application"], "argocd")
        status = app.get("status", {})
        summary = (status.get("sync", {}).get("status"), status.get("health", {}).get("status"),
                   status.get("operationState", {}).get("phase"))
        if summary != previous:
            print("Argo CD status: " + str(summary), flush=True)
            previous = summary
        if summary[:2] == ("Synced", "Healthy"):
            print("Preview synced and healthy", flush=True)
            return
        if summary[2] in ["Failed", "Error"]:
            raise RuntimeError("Argo sync failed; inspect Application status and controller events")
        time.sleep(10)
    raise TimeoutError("Preview did not become healthy within 25 minutes")


def verify(state):
    run(["mise", "exec", "--", "pnpm", "--filter", "@skjera/app", "exec", "node", "e2e/preview-smoke.ts", str(JOURNAL)])
    state.update(json.loads(JOURNAL.read_text()))
    head = aws("s3api", "head-object", "--bucket", state["bucket"], "--key", state["uploadedKey"])
    assert head["ServerSideEncryption"] == "AES256"
    k = kube()
    sql = "SELECT extversion FROM pg_extension WHERE extname='pg_automerge'; SELECT count(*) FROM oauth_sessions;"
    output = subprocess.check_output(k + ["-n", state["namespace"], "exec", "postgres-1", "-c", "postgres", "--",
                                          "psql", "-U", "postgres", "-d", "skjera", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql]).decode().splitlines()
    assert output[0] == "0.1.0" and int(output[1]) > 0, "Database extension/session persistence check failed"
    pods = get(k, "pods", namespace=state["namespace"])["items"]
    app = next(pod for pod in pods if pod["metadata"].get("labels", {}).get("app") == "app")
    names = {env["name"] for env in app["spec"]["containers"][0]["env"]}
    assert {"AWS_CONTAINER_CREDENTIALS_FULL_URI", "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE"} <= names
    assert not names.intersection({"S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"})
    print("PASS: real S3 object encryption, PostgreSQL extension/session persistence and injected Pod Identity", flush=True)
    state["verified"] = True
    save(state)


def cleanup(state):
    k = kube()
    namespace = state["namespace"]
    volume_ids = list(state.get("volumeIds", []))
    claims = get(k, "pvc", namespace=namespace).get("items", []) if get(k, "namespace", namespace) else []
    for pvc in claims:
        name = pvc.get("spec", {}).get("volumeName")
        if name:
            volume_ids.append(get(k, "pv", name)["spec"]["csi"]["volumeHandle"])
    state["volumeIds"] = sorted(set(volume_ids))
    save(state)
    print("Deleting the Argo Application with cascading cleanup", flush=True)
    run(k + ["-n", "argocd", "delete", "application", state["application"], "--ignore-not-found", "--timeout=900s"])
    if get(k, "namespace", namespace):
        # Also handles a failure before the Application was created.
        run(k + ["delete", "namespace", namespace, "--timeout=600s"])
    assert not get(k, "namespace", namespace)
    absent = subprocess.run(["aws", "s3api", "head-bucket", "--bucket", state["bucket"], "--region", REGION], capture_output=True, text=True)
    assert absent.returncode != 0 and "(404)" in absent.stderr, "Preview bucket deletion not confirmed"
    for volume in state["volumeIds"]:
        deadline = time.monotonic() + 300
        while True:
            absent = subprocess.run(["aws", "ec2", "describe-volumes", "--volume-ids", volume, "--region", REGION], capture_output=True, text=True)
            if absent.returncode != 0 and "InvalidVolume.NotFound" in absent.stderr:
                break
            if absent.returncode != 0 or time.monotonic() > deadline:
                raise RuntimeError("Preview EBS deletion not confirmed; inspect volume " + volume)
            time.sleep(3)
    identities = aws("eks", "list-pod-identity-associations", "--cluster-name", f"skjera-{ENVIRONMENT}")["associations"]
    assert not any(identity["namespace"] == namespace for identity in identities), "Preview Pod Identity association remains"
    run(k + ["-n", "argocd", "delete", "appproject", state["application"], "--ignore-not-found"], stdout=subprocess.DEVNULL)
    run(k + ["-n", "argocd", "delete", "secret", state["application"], "--ignore-not-found"], stdout=subprocess.DEVNULL)
    digests = set(state.get("previousDigests", [])) | {state[field] for field in ["artifactDigest", "imageDigest"] if state.get(field)}
    for image_digest in digests:
        response = aws("ecr", "batch-delete-image", "--repository-name", REPOSITORY,
                       "--image-ids", f"imageDigest={image_digest}")
        assert all(failure.get("failureCode") == "ImageNotFound" for failure in response.get("failures", [])), response.get("failures")
    if not state.get("dockerWasLoggedIn", True):
        run(["docker", "logout", REGISTRY], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for tag in state.get("previousImageTags", []) + ([state["imageTag"]] if state.get("built") else []):
        run(["docker", "image", "rm", f"{IMAGE_REPO}:{tag}"], stdout=subprocess.DEVNULL)
    for file in ["registry.json", "manifests.tar.gz", "browser-error.log"]:
        (LOCAL / file).unlink(missing_ok=True)
    state.pop("password", None)
    state["cleaned"] = True
    save(state)
    print("PASS: Application, namespace, bucket, database, EBS, Pod Identity, temporary Argo credentials and published smoke artifacts removed", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", nargs="?", choices=["all", "build", "publish", "deploy", "wait", "verify", "cleanup"], default="all")
    args = parser.parse_args()
    lock = (LOCAL / "run.lock").open("w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit("Another preview smoke command is running; wait for it to finish")
    if args.stage in ["deploy", "wait", "verify", "cleanup"]:
        state = json.loads(JOURNAL.read_text()) if JOURNAL.exists() else None
        if state is None or state.get("cleaned"):
            if args.stage == "cleanup":
                print("No active preview remains; cleanup is already complete")
                raise SystemExit(0)
            raise SystemExit("No active preview; run publish or the full smoke task first")
    else:
        state = load()
    if args.stage == "all":
        try:
            publish(state)
            deploy(state)
            wait(state)
            verify(state)
        finally:
            cleanup(state)
    else:
        globals()[args.stage](state)
