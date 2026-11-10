"""GitHub API calls and strict validation of image metadata from an unprivileged run."""

import io
import json
import os
import re
import urllib.request
import zipfile

REPOSITORY = "capraconsulting/skjera"
IMAGE = re.compile(r"440027025698\.dkr\.ecr\.eu-north-1\.amazonaws\.com/skjera-dev@sha256:[a-f0-9]{64}")


def api(path, data=None):
    request = urllib.request.Request("https://api.github.com/" + path,
        data=json.dumps(data).encode() if data is not None else None, headers={
        "Authorization": "Bearer " + os.environ["GH_TOKEN"],
        "Content-Type": "application/json",
        "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
    })
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def pages(path, key=None):
    page = 1
    while True:
        separator = "&" if "?" in path else "?"
        result = api(f"{path}{separator}per_page=100&page={page}")
        values = result[key] if key else result
        yield from values
        if len(values) < 100:
            return
        page += 1


def eligible(pr):
    return (pr["state"] == "open" and pr["head"]["repo"] is not None and
            pr["head"]["repo"]["full_name"] == REPOSITORY and
            pr["user"]["login"] != "dependabot[bot]")


def validate(metadata, run, pr):
    """Artifacts are data, never instructions; reject forks and stale/forged runs."""
    if not eligible(pr):
        return False
    if not isinstance(metadata, dict):
        raise ValueError("Invalid image metadata")
    if not IMAGE.fullmatch(metadata.get("image", "")):
        raise ValueError("Image must be a digest in the app's ECR repository")
    if (run["event"] != "pull_request" or run["conclusion"] != "success" or
            run["head_repository"]["full_name"] != REPOSITORY or
            run["actor"]["login"] == "dependabot[bot]"):
        raise ValueError("Only successful same-repository PR builds may deploy")
    if str(pr["number"]) != metadata.get("prNumber") or not re.fullmatch(r"[1-9][0-9]{0,8}", metadata["prNumber"]):
        raise ValueError("PR number does not match metadata")
    if str(run["id"]) != metadata.get("runId") or str(run["run_attempt"]) != metadata.get("runAttempt"):
        raise ValueError("Artifact belongs to a different run or attempt")
    if run["head_branch"] != pr["head"]["ref"]:
        raise ValueError("Build branch differs from PR branch")
    if metadata.get("headSha") != run["head_sha"]:
        raise ValueError("Artifact does not match the build's head commit")
    return pr["head"]["sha"] == metadata["headSha"]


def image_artifact(run):
    artifacts = list(pages(f"repos/{REPOSITORY}/actions/runs/{run['id']}/artifacts", "artifacts"))
    candidates = [a for a in artifacts if a["name"] == "preview-image" and not a["expired"]]
    if len(candidates) != 1:
        raise ValueError("Expected exactly one non-expired preview-image artifact")
    artifact = candidates[0]
    if artifact["size_in_bytes"] > 64 * 1024:
        raise ValueError("Preview metadata artifact is too large")
    # gh handles the authenticated API redirect without forwarding its token
    # to the signed artifact-storage URL. Never extract arbitrary ZIP paths.
    import subprocess
    content = subprocess.check_output([
        "gh", "api", f"repos/{REPOSITORY}/actions/artifacts/{artifact['id']}/zip",
    ])
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        if archive.namelist() != ["preview-image.json"] or archive.getinfo("preview-image.json").file_size > 4096:
            raise ValueError("Unexpected preview artifact contents")
        return json.loads(archive.read("preview-image.json"))
