"""Update desired state using trusted main-branch code, never PR code.

Default is a local dry run. --push is only for the dedicated GitHub workflow.
"""

import argparse
import base64
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

from github import REPOSITORY, api, eligible, image_artifact, pages, validate
from preview_secrets import ensure_secret


def git(directory, *arguments, **options):
    return subprocess.run(["git", "-C", str(directory), *arguments], check=True, **options)


def remove_closed(directory, lookup):
    """Only remove known preview directories after a successful GitHub lookup."""
    for preview in sorted((directory / "previews").iterdir()):
        if not preview.is_dir():
            continue
        match = re.fullmatch(r"pr-([1-9][0-9]{0,8})", preview.name)
        if not match or preview.is_symlink():
            raise ValueError(f"Unexpected preview directory: {preview.name}")
        if not eligible(lookup(match[1])):
            shutil.rmtree(preview)
            print(f"Removed desired state for {preview.name}; Argo CD will cascade deletion.")


def update(directory, metadata, run, pr, lookup=None):
    if not validate(metadata, run, pr):
        print("PR is closed or has a newer commit; ignoring this build.")
        return None
    number = metadata["prNumber"]
    target = directory / "previews" / f"pr-{number}"
    config = target / "config.json"
    if config.exists():
        previous = json.loads(config.read_text())
        version = lambda item: (int(item["runId"]), int(item["runAttempt"]))
        if version(previous) > version(metadata):
            print("A newer successful build is already recorded; ignoring this run.")
            return None
    target.mkdir(parents=True, exist_ok=True)
    ensure_secret(target, number, directory / "config/sealed-secrets.crt")
    if lookup and not validate(metadata, run, lookup(number)):
        if not config.exists():
            shutil.rmtree(target)
        print("PR changed during secret preparation; ignoring this build.")
        return None
    config.write_text(json.dumps(metadata, indent=2) + "\n")
    return metadata


def candidates(event, directory):
    if "workflow_run" in event:
        # Re-read the run from GitHub instead of trusting an artifact's claims.
        run = api(f"repos/{REPOSITORY}/actions/runs/{event['workflow_run']['id']}")
        return [(image_artifact(run), run)]
    if "pull_request" in event:
        return []
    # GitHub can replace pending jobs even with cancellation off. Backfill
    # successful builds on scheduled/manual runs, including missed PR events.
    result = []
    for pr in pages(f"repos/{REPOSITORY}/pulls?state=open"):
        if not eligible(pr):
            continue
        runs = api(f"repos/{REPOSITORY}/actions/workflows/ci.yml/runs?event=pull_request&status=success&head_sha={pr['head']['sha']}&per_page=1")
        if runs["workflow_runs"]:
            run = runs["workflow_runs"][0]
            try:
                result.append((image_artifact(run), run))
            except ValueError:
                print(f"No usable image artifact for PR {pr['number']}; rerun CI to publish one.")
    return result


def reconcile(directory, event, push=False):
    if os.environ.get("GITHUB_REPOSITORY", REPOSITORY) != REPOSITORY:
        raise ValueError("This automation belongs to capraconsulting/skjera")
    if not (directory / "templates/preview/main.jsonnet").is_file():
        raise ValueError("Run mise run preview:prepare before enabling automation")
    builds = candidates(event, directory)
    lookup = lambda pr: api(f"repos/{REPOSITORY}/pulls/{pr}")
    # Non-fast-forward pushes must never overwrite an operator's changes.
    for attempt in range(3):
        deployed = None
        remove_closed(directory, lookup)
        for metadata, run in builds:
            deployed = update(directory, metadata, run, lookup(metadata["prNumber"]), lookup)
        # A PR can close while hashing/sealing. Check again before committing.
        remove_closed(directory, lookup)
        if deployed and not (directory / f"previews/pr-{deployed['prNumber']}/config.json").exists():
            deployed = None
        if not push:
            print("Dry run: local desired state updated; no commit or push.")
            return deployed
        git(directory, "add", "--", "previews")
        if subprocess.run(["git", "-C", str(directory), "diff", "--cached", "--quiet"]).returncode == 0:
            return deployed
        git(directory, "-c", "user.name=skjera-preview[bot]", "-c",
            "user.email=skjera-preview[bot]@users.noreply.github.com",
            "commit", "-m", "Reconcile Skjera PR previews")
        authorization = base64.b64encode(("x-access-token:" + os.environ["DEPLOY_TOKEN"]).encode()).decode()
        environment = {**os.environ, "GIT_CONFIG_COUNT": "1",
                       "GIT_CONFIG_KEY_0": "http.https://github.com/.extraheader",
                       "GIT_CONFIG_VALUE_0": "AUTHORIZATION: basic " + authorization}
        result = subprocess.run(["git", "-C", str(directory), "push", "origin", "HEAD:main"], env=environment)
        if result.returncode == 0:
            return deployed
        if attempt < 2:
            git(directory, "fetch", "origin", "main", env=environment)
            git(directory, "reset", "--hard", "origin/main")
    raise RuntimeError("Deployment repository changed repeatedly; retry reconciliation")


def report(metadata):
    if not metadata:
        return
    number = metadata["prNumber"]
    url = f"https://pr-{number}.skjera.capraconsulting.no"
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as output:
            output.write(f"Argo CD desired state updated: [{url}]({url})\n\nImage: `{metadata['image']}`\n")
    outputs = os.environ.get("GITHUB_OUTPUT")
    if outputs:
        with open(outputs, "a") as output:
            for key in ["prNumber", "image", "headSha"]:
                output.write(f"{key}={metadata[key]}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--push", action="store_true")
    arguments = parser.parse_args()
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    report(reconcile(arguments.directory.resolve(), event, arguments.push))
