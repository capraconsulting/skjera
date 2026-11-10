"""Wait for the desired image to answer over public HTTPS with a healthy DB."""

import os
import time
import urllib.error
import urllib.request

from github import REPOSITORY, api, eligible


def wait(pr, image, head, timeout=1500):
    deadline = time.monotonic() + timeout
    url = f"https://pr-{pr}.skjera.capraconsulting.no"
    while time.monotonic() < deadline:
        current = api(f"repos/{REPOSITORY}/pulls/{pr}")
        if not eligible(current) or current["head"]["sha"] != head:
            print("Preview was closed or superseded; stopping readiness check.")
            return
        try:
            with urllib.request.urlopen(url + "/health/ready", timeout=15) as response:
                if response.status == 200 and response.headers.get("X-Skjera-Image") == image and response.read() == b"ok":
                    print(f"Desired image is ready: {url}")
                    if os.environ.get("GITHUB_STEP_SUMMARY"):
                        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as output:
                            output.write(f"Preview ready: [{url}]({url})\n\nLogin: `preview@example.com` (password in PREVIEW_DEX_PASSWORD).\n")
                    return
        except (urllib.error.URLError, TimeoutError):
            pass  # Argo CD and Auto Mode can take time to provision dependencies.
        time.sleep(10)
    raise TimeoutError(f"Desired image did not become ready at {url}; inspect Argo CD")


if __name__ == "__main__":
    wait(os.environ["PR_NUMBER"], os.environ["IMAGE"], os.environ["HEAD_SHA"])
