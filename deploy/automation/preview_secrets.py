"""Namespace-bound SealedSecrets; plaintext never touches disk or stdout."""

import base64
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess


def certificate_hash(certificate):
    return hashlib.sha256(certificate.read_bytes()).hexdigest()


def secret_data(pr, password):
    if not password or len(password) < 20 or "\n" in password:
        raise ValueError("Set PREVIEW_DEX_PASSWORD to at least 20 characters without newlines")
    hashed = subprocess.check_output(
        ["htpasswd", "-niB", "-C", "10", "preview"],
        input=(password + "\n").encode(),
    ).decode().strip().split(":", 1)[1]
    client = secrets.token_urlsafe(32)
    site = f"https://pr-{pr}.skjera.capraconsulting.no"
    dex = {
        "issuer": site + "/dex", "storage": {"type": "memory"},
        "web": {"http": "0.0.0.0:5556"}, "telemetry": {"http": "0.0.0.0:5558"},
        "oauth2": {"responseTypes": ["code"], "skipApprovalScreen": True},
        "staticClients": [{"id": "skjera-preview", "secret": client,
                           "name": "Skjera preview", "redirectURIs": [site + "/auth/callback"]}],
        "enablePasswordDB": True,
        "staticPasswords": [{"email": "preview@example.com", "username": "preview",
                             "userID": "skjera-preview", "hash": hashed}],
    }
    return {"signing-secret": secrets.token_urlsafe(48),
            "oidc-client-secret": client, "dex-config": json.dumps(dex)}


def ensure_secret(directory, pr, certificate):
    target = directory / "sealed-secret.json"
    fingerprint = certificate_hash(certificate)
    annotation = "skjera.capraconsulting.no/sealing-certificate"
    if target.exists():
        existing = json.loads(target.read_text())
        if existing.get("metadata", {}).get("annotations", {}).get(annotation) == fingerprint:
            return  # Keep sessions and OIDC clients stable across image updates.
    namespace = f"skjera-pr-{pr}"
    data = secret_data(pr, os.environ.get("PREVIEW_DEX_PASSWORD", ""))
    secret = {
        "apiVersion": "v1", "kind": "Secret", "type": "Opaque",
        "metadata": {"name": "preview-app", "namespace": namespace},
        "data": {key: base64.b64encode(value.encode()).decode() for key, value in data.items()},
    }
    result = subprocess.run(
        ["kubeseal", "--cert", str(certificate), "--scope", "strict", "--format", "json"],
        input=json.dumps(secret).encode(), capture_output=True, check=True,
    )
    sealed = json.loads(result.stdout)
    sealed["metadata"]["annotations"] = {
        "argocd.argoproj.io/sync-wave": "-25", annotation: fingerprint,
    }
    target.write_text(json.dumps(sealed, indent=2) + "\n")
