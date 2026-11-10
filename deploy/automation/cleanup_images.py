"""Remove only PR-tagged images whose PR is closed; keep main and open PRs."""

import argparse
import json
import re
import subprocess

from github import REPOSITORY, api

TAG = re.compile(r"pr-([1-9][0-9]{0,8})-sha-[a-f0-9]{40}-[0-9]+-[0-9]+")


def closed_tags(images, lookup):
    states = {}
    result = []
    for image in images:
        for tag in image.get("imageTags", []):
            match = TAG.fullmatch(tag)
            if match:
                pr = match[1]
                if pr not in states:
                    states[pr] = lookup(pr)["state"]
                if states[pr] == "closed":
                    result.append({"imageTag": tag})
    return result


def aws(*arguments):
    return json.loads(subprocess.check_output([
        "aws", "ecr", *arguments, "--repository-name", "skjera-dev",
        "--region", "eu-north-1", "--output", "json",
    ]))


def cleanup(apply=False):
    # AWS CLI paginates describe-images automatically.
    images = aws("describe-images")["imageDetails"]
    tags = closed_tags(images, lambda pr: api(f"repos/{REPOSITORY}/pulls/{pr}"))
    print(f"Closed-preview image tags eligible for cleanup: {len(tags)}")
    if not apply:
        print("Dry run; no ECR changes.")
        return
    for start in range(0, len(tags), 100):
        result = aws("batch-delete-image", "--image-ids", json.dumps(tags[start:start + 100]))
        failures = [f for f in result.get("failures", []) if f["failureCode"] != "ImageNotFound"]
        if failures:
            raise RuntimeError(f"ECR rejected {len(failures)} image deletions")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    cleanup(parser.parse_args().apply)
