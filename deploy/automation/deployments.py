"""Publish preview links using GitHub deployments, without PR comments."""

import os
import re

from github import REPOSITORY, api, eligible, pages

TASK = "skjera-preview"
ROOT = f"repos/{REPOSITORY}/deployments"


def status(deployment, state, description):
    run = os.environ["GITHUB_RUN_ID"]
    return api(f"{ROOT}/{deployment['id']}/statuses", {
        "state": state, "description": description,
        "environment_url": f"https://{deployment['environment']}.skjera.capraconsulting.no",
        "log_url": f"https://github.com/{REPOSITORY}/actions/runs/{run}",
        "auto_inactive": False,
    })


def create(pr, head):
    deployment = api(ROOT, {
        "ref": head, "task": TASK, "environment": f"pr-{pr}",
        "auto_merge": False, "required_contexts": [],
        "transient_environment": True, "production_environment": False,
        "description": f"Argo CD preview for PR #{pr}",
    })
    status(deployment, "in_progress", "Waiting for the published image and database over HTTPS")
    return deployment


def retire_closed():
    """Reconcile closed/superseded links, including missed close events."""
    pulls = {}
    for deployment in pages(f"{ROOT}?task={TASK}"):
        match = re.fullmatch(r"pr-([1-9][0-9]{0,8})", deployment["environment"])
        if not match:
            continue
        number = match[1]
        if number not in pulls:
            pulls[number] = api(f"repos/{REPOSITORY}/pulls/{number}")
        pr = pulls[number]
        if eligible(pr) and pr["head"]["sha"] == deployment["sha"]:
            continue
        latest = api(f"{ROOT}/{deployment['id']}/statuses?per_page=1")
        if not latest or latest[0]["state"] != "inactive":
            status(deployment, "inactive", "Preview closed or replaced by a newer PR revision")


if __name__ == "__main__":
    retire_closed()
