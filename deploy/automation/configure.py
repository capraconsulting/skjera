"""Operator enrollment for private repo access and preview login. Never pushes Git."""

import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
LOCAL = ROOT / ".local"
REPOSITORY = "capraconsulting/skjera"
KEY_BACKUP = "s3://skjera-dev-tofu-440027025698-eu-north-1/argocd/sealed-secrets-keys.json"


def run(*arguments, data=None):
    return subprocess.check_output(list(arguments), input=data)


def kubernetes(*arguments, data=None):
    with tempfile.TemporaryDirectory(prefix="skjera-argocd-kube-") as temp:
        kubeconfig = str(Path(temp) / "config")
        run("aws", "eks", "update-kubeconfig", "--region", "eu-north-1", "--name",
            "skjera-dev", "--kubeconfig", kubeconfig)
        return subprocess.check_output([
            "mise", "exec", "kubectl@1.35", "--", "kubectl", *arguments,
        ], input=data, env={**os.environ, "KUBECONFIG": kubeconfig})


def repository():
    LOCAL.mkdir(mode=0o700, exist_ok=True)
    key = LOCAL / "argocd-deploy.key"
    if not key.exists():
        subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C",
                        "skjera-dev-argocd-read-only", "-f", str(key)], check=True)
    key.chmod(0o600)
    public = key.with_suffix(".key.pub").read_text().strip()
    keys = json.loads(run("gh", "api", "repos/capraconsulting/skjera-deploy/keys"))
    # Compare key material; GitHub may normalize the comment.
    if not any(item["key"].split()[:2] == public.split()[:2] for item in keys):
        run("gh", "api", "--method", "POST", "repos/capraconsulting/skjera-deploy/keys",
            "--input", "-", data=json.dumps({"title": "skjera-dev Argo CD (read only)",
                                             "key": public, "read_only": True}).encode())
    secret = {"apiVersion": "v1", "kind": "Secret", "metadata": {
        "name": "skjera-deploy", "namespace": "argocd",
        "labels": {"argocd.argoproj.io/secret-type": "repository"}},
        "stringData": {"type": "git", "url": "git@github.com:capraconsulting/skjera-deploy.git",
                       "sshPrivateKey": key.read_text()}}
    kubernetes("apply", "--server-side", "--field-manager=skjera-repo-enrollment",
               "-f", "-", data=json.dumps(secret).encode())
    print("Registered Argo CD's read-only deploy key and repository credential.")


def backup_keys():
    data = json.loads(kubernetes("-n", "kube-system", "get", "secrets", "-l",
                                "sealedsecrets.bitnami.com/sealed-secrets-key", "-o", "json"))
    if not data["items"]:
        raise ValueError("No controller keys found; refusing to overwrite a backup")
    for secret in data["items"]:
        metadata = secret["metadata"]
        secret["metadata"] = {key: metadata[key] for key in ["name", "namespace", "labels"]}
    run("aws", "s3", "cp", "-", KEY_BACKUP, "--region", "eu-north-1", "--sse", "AES256",
        "--only-show-errors", data=json.dumps(data).encode())
    print("Backed up controller keys to encrypted, versioned private state storage.")


def restore_keys():
    data = run("aws", "s3", "cp", KEY_BACKUP, "-", "--region", "eu-north-1", "--only-show-errors")
    kubernetes("apply", "--server-side", "--field-manager=skjera-key-recovery", "-f", "-", data=data)
    print("Restored sealing keys. Restart sealed-secrets-controller if it is already running.")


def app(client_id, key):
    run("gh", "variable", "set", "DEPLOY_APP_CLIENT_ID", "--repo", REPOSITORY,
        "--body", client_id)
    run("gh", "secret", "set", "DEPLOY_APP_PRIVATE_KEY", "--repo", REPOSITORY,
        data=key.read_bytes())
    print("Configured the deployment App identifier and private key in GitHub.")


def login():
    known = json.loads(run("gh", "api", f"repos/{REPOSITORY}/actions/secrets"))["secrets"]
    if any(item["name"] == "PREVIEW_DEX_PASSWORD" for item in known):
        print("PREVIEW_DEX_PASSWORD already exists; keeping the existing login.")
        return
    LOCAL.mkdir(mode=0o700, exist_ok=True)
    target = LOCAL / "preview-login.json"
    if target.exists():
        password = json.loads(target.read_text())["password"]
    else:
        password = secrets.token_urlsafe(32)
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as output:
            json.dump({"email": "preview@example.com", "password": password}, output)
    run("gh", "secret", "set", "PREVIEW_DEX_PASSWORD", "--repo", REPOSITORY,
        data=password.encode())
    print(f"Configured preview login; credentials are in ignored private file {target}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("repository")
    commands.add_parser("login")
    commands.add_parser("backup-keys")
    commands.add_parser("restore-keys")
    application = commands.add_parser("app")
    application.add_argument("client_id")
    application.add_argument("private_key", type=Path)
    args = parser.parse_args()
    if args.command == "repository":
        repository()
    elif args.command == "login":
        login()
    elif args.command == "backup-keys":
        backup_keys()
    elif args.command == "restore-keys":
        restore_keys()
    else:
        app(args.client_id, args.private_key)
