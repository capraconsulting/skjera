"""Verify namespace isolation and public routing through the shared NLB.

Uses a temporary HTTP redirect route, not an application or public credentials.
Run from the repository root after provisioning the gateway.
"""

import json
from pathlib import Path
import secrets
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def wait_for(check, timeout, message):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(2)
    raise TimeoutError(message)


settings = json.loads(Path("infra/gateway/bootstrap.auto.tfvars.json").read_text())
identity = json.loads(subprocess.check_output(["aws", "sts", "get-caller-identity"]))
assert identity["Account"] == settings["aws_account_id"], "Wrong AWS account"
namespace = "gateway-smoke-" + secrets.token_hex(4)
host = namespace + ".example.test"

with tempfile.TemporaryDirectory(prefix="skjera-gateway-smoke-") as directory:
    config = str(Path(directory) / "kubeconfig")
    run(["aws", "eks", "update-kubeconfig", "--region", settings["aws_region"],
         "--name", f"skjera-{settings['environment']}", "--kubeconfig", config], stdout=subprocess.DEVNULL)
    k = ["mise", "exec", "kubectl@1.35", "--", "kubectl", "--kubeconfig", config, "--request-timeout=20s"]
    run(k + ["-n", "envoy-gateway-system", "wait", "gateway/previews", "--for=condition=Programmed", "--timeout=600s"])
    gateway = json.loads(subprocess.check_output(k + ["-n", "envoy-gateway-system", "get", "gateway", "previews", "-o", "json"]))
    address = gateway["status"]["addresses"][0]["value"]
    print(f"Testing public gateway {address}", flush=True)
    run(k + ["create", "namespace", namespace])
    route = {
        "apiVersion": "gateway.networking.k8s.io/v1", "kind": "HTTPRoute",
        "metadata": {"name": "smoke", "namespace": namespace},
        "spec": {
            "parentRefs": [{"name": "previews", "namespace": "envoy-gateway-system", "sectionName": "http"}],
            "hostnames": [host],
            "rules": [{"filters": [{"type": "RequestRedirect", "requestRedirect": {
                "scheme": "https", "hostname": "gateway-verified.example.test", "statusCode": 302,
            }}]}],
        },
    }
    try:
        run(k + ["apply", "-f", "-"], input=json.dumps(route).encode())

        def accepted(value):
            resource = json.loads(subprocess.check_output(k + ["-n", namespace, "get", "httproute", "smoke", "-o", "json"]))
            return any(condition["type"] == "Accepted" and condition["status"] == value
                       for parent in resource.get("status", {}).get("parents", [])
                       for condition in parent.get("conditions", []))

        wait_for(lambda: accepted("False"), 120, "Unlabelled namespace was not rejected")
        print("Unlabelled namespace rejected as expected.", flush=True)
        run(k + ["label", "namespace", namespace, "skjera.capraconsulting.no/preview=true"])
        wait_for(lambda: accepted("True"), 120, "Labelled preview route was not accepted")
        opener = urllib.request.build_opener(NoRedirect())

        def routed():
            try:
                request = urllib.request.Request(f"http://{address}/", headers={"Host": host})
                opener.open(request, timeout=5).close()
                return False
            except urllib.error.HTTPError as response:
                return response.code == 302 and response.headers.get("Location") == "https://gateway-verified.example.test/"
            except (urllib.error.URLError, TimeoutError):
                return False

        wait_for(routed, 300, "Public NLB did not deliver the expected route response")
        run(k + ["delete", "namespace", namespace, "--timeout=120s"])
        print("PASS: preview namespace isolation and public NLB -> Envoy -> HTTPRoute routing verified.", flush=True)
    except Exception:
        print(f"Test failed; inspect namespace {namespace} and the shared gateway.", flush=True)
        subprocess.run(k + ["-n", namespace, "get", "httproute", "-o", "wide"])
        raise
