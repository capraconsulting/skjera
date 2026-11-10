"""Prepare a deployment checkout and optionally export its public sealing cert.

Never pushes Git or exports cluster private keys.
"""

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def prepare(destination, certificate=False):
    destination = destination.resolve()
    if not (destination / ".git").exists():
        raise ValueError("Clone capraconsulting/skjera-deploy first")
    remote = subprocess.check_output(
        ["git", "-C", str(destination), "remote", "get-url", "origin"], text=True
    ).strip()
    if remote not in ["git@github.com:capraconsulting/skjera-deploy.git",
                      "https://github.com/capraconsulting/skjera-deploy.git"]:
        raise ValueError("Destination must be the skjera-deploy repository")
    templates = destination / "templates/preview"
    templates.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / "deploy/preview/main.jsonnet", templates / "main.jsonnet")
    shutil.copytree(ROOT / "deploy/preview/lib", templates / "lib", dirs_exist_ok=True)
    (destination / "previews").mkdir(exist_ok=True)
    (destination / "previews/.gitkeep").touch()
    (destination / "config").mkdir(exist_ok=True)
    shutil.copy2(ROOT / "deploy/automation/deploy-Readme.md", destination / "Readme.md")
    ignore = destination / ".gitignore"
    required = [".local/", "*.key", "*.pem", ".env", ".env.*", "__pycache__/"]
    existing = ignore.read_text().splitlines() if ignore.exists() else []
    ignore.write_text("\n".join(existing + [x for x in required if x not in existing]) + "\n")
    if certificate:
        with tempfile.TemporaryDirectory(prefix="skjera-preview-kube-") as temp:
            kubeconfig = str(Path(temp) / "config")
            subprocess.run(["aws", "eks", "update-kubeconfig", "--region", "eu-north-1",
                            "--name", "skjera-dev", "--kubeconfig", kubeconfig],
                           check=True, stdout=subprocess.DEVNULL)
            cert = subprocess.check_output([
                "mise", "exec", "--", "kubeseal", "--fetch-cert",
                "--controller-name", "sealed-secrets-controller",
                "--controller-namespace", "kube-system",
            ], env={**os.environ, "KUBECONFIG": kubeconfig})
            if not cert.startswith(b"-----BEGIN CERTIFICATE-----"):
                raise ValueError("Controller did not return a public certificate")
            (destination / "config/sealed-secrets.crt").write_bytes(cert)
    print(f"Prepared {destination}; review git diff there before committing or pushing.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--certificate", action="store_true")
    arguments = parser.parse_args()
    prepare(arguments.directory, arguments.certificate)
