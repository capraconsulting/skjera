"""Verify wildcard DNS/TLS, HTTPS routing, redirects and forwarding headers.

Run after bootstrap, DNS and gateway provisioning. Temporary resources are
removed on success; failures preserve the namespace for diagnosis.
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
domain = "skjera.capraconsulting.no"
namespace = "gateway-smoke-" + secrets.token_hex(4)
host = namespace + "." + domain
server = """
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
class Echo(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({'headers': dict(self.headers), 'path': self.path}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
HTTPServer(('0.0.0.0', 8080), Echo).serve_forever()
"""

with tempfile.TemporaryDirectory(prefix="skjera-gateway-smoke-") as directory:
    config = str(Path(directory) / "kubeconfig")
    run(["aws", "eks", "update-kubeconfig", "--region", settings["aws_region"],
         "--name", f"skjera-{settings['environment']}", "--kubeconfig", config], stdout=subprocess.DEVNULL)
    k = ["mise", "exec", "kubectl@1.35", "--", "kubectl", "--kubeconfig", config, "--request-timeout=20s"]
    run(k + ["-n", "envoy-gateway-system", "wait", "gateway/previews", "--for=condition=Programmed", "--timeout=600s"])
    run(k + ["create", "namespace", namespace])
    route = {
        "apiVersion": "gateway.networking.k8s.io/v1", "kind": "HTTPRoute",
        "metadata": {"name": "smoke", "namespace": namespace},
        "spec": {
            "parentRefs": [{"name": "previews", "namespace": "envoy-gateway-system", "sectionName": "https"}],
            "hostnames": [domain, host],
            "rules": [{"backendRefs": [{"name": "echo", "port": 8080}]}],
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
        run(k + ["label", "namespace", namespace, "skjera.capraconsulting.no/preview=true"])
        wait_for(lambda: accepted("True"), 120, "Labelled preview route was not accepted")
        manifests = {"apiVersion": "v1", "kind": "List", "items": [
            {"apiVersion": "v1", "kind": "Pod", "metadata": {"name": "echo", "namespace": namespace, "labels": {"app": "echo"}},
             "spec": {"automountServiceAccountToken": False, "securityContext": {"runAsUser": 65532, "runAsNonRoot": True, "seccompProfile": {"type": "RuntimeDefault"}},
                      "containers": [{"name": "echo", "image": "python:3.14-slim@sha256:9aaa474097d094040649f2162a627c0049b408f52138d980916788d80f04802f",
                                      "command": ["python3", "-u", "-c", server],
                                      "securityContext": {"allowPrivilegeEscalation": False, "readOnlyRootFilesystem": True, "capabilities": {"drop": ["ALL"]}},
                                      "resources": {"requests": {"cpu": "10m", "memory": "32Mi"}, "limits": {"memory": "128Mi"}},
                                      "readinessProbe": {"httpGet": {"path": "/", "port": 8080}}}]}},
            {"apiVersion": "v1", "kind": "Service", "metadata": {"name": "echo", "namespace": namespace},
             "spec": {"selector": {"app": "echo"}, "ports": [{"port": 8080, "targetPort": 8080}]}},
        ]}
        run(k + ["apply", "-f", "-"], input=json.dumps(manifests).encode())
        run(k + ["-n", namespace, "wait", "pod/echo", "--for=condition=Ready", "--timeout=300s"])
        opener = urllib.request.build_opener(NoRedirect())
        for hostname in [domain, host]:
            def routed():
                try:
                    request = urllib.request.Request(f"https://{hostname}/probe?check=tls", headers={
                        "X-Forwarded-Proto": "http", "X-Forwarded-Port": "80",
                        "X-Forwarded-For": "192.0.2.1", "Forwarded": "proto=http;host=attacker.invalid",
                    })
                    with opener.open(request, timeout=5) as response:
                        data = json.load(response)
                    headers = {key.lower(): value for key, value in data["headers"].items()}
                    assert headers.get("x-forwarded-proto") == "https", headers
                    assert headers.get("x-forwarded-port") == "443", headers
                    assert "forwarded" not in headers and "192.0.2.1" not in headers.get("x-forwarded-for", ""), headers
                    assert data["path"] == "/probe?check=tls", data
                    return True
                except (urllib.error.URLError, TimeoutError):
                    return False

            wait_for(routed, 300, f"HTTPS routing not ready for {hostname}")
            try:
                opener.open(f"http://{hostname}/probe?check=tls", timeout=10).close()
                raise AssertionError("HTTP request was not redirected")
            except urllib.error.HTTPError as response:
                assert response.code == 301, response.code
                assert response.headers["Location"] == f"https://{hostname}/probe?check=tls", response.headers
            print(f"PASS: {hostname}: trusted TLS, routing, sanitized HTTPS headers and HTTP redirect", flush=True)
        run(k + ["delete", "namespace", namespace, "--timeout=180s"])
        print("PASS: wildcard DNS and shared ACM certificate work without per-preview records or certificates.", flush=True)
    except Exception:
        print(f"Test failed; inspect namespace {namespace}.", flush=True)
        subprocess.run(k + ["-n", namespace, "get", "httproute,pods,svc", "-o", "wide"])
        raise
