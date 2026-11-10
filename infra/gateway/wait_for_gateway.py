"""Wait for Auto Mode's asynchronous NLB/listener creation; no AWS mutations."""

import json
import os
import subprocess
import time

region = os.environ["GATEWAY_REGION"]
certificate = os.environ["GATEWAY_CERTIFICATE"]
credentials = json.loads(subprocess.check_output([
    "aws", "sts", "assume-role", "--role-arn", os.environ["GATEWAY_ROLE_ARN"],
    "--role-session-name", "gateway-readiness", "--region", region, "--output", "json",
]))["Credentials"]
environment = dict(os.environ)
environment.pop("AWS_PROFILE", None)
environment.update({
    "AWS_ACCESS_KEY_ID": credentials["AccessKeyId"],
    "AWS_SECRET_ACCESS_KEY": credentials["SecretAccessKey"],
    "AWS_SESSION_TOKEN": credentials["SessionToken"],
})


def aws(*args):
    output = subprocess.check_output(["aws", *args, "--region", region, "--output", "json"], env=environment)
    return json.loads(output or b"{}")


expected = {
    "eks:eks-cluster-name": os.environ["GATEWAY_CLUSTER"],
    "service.eks.amazonaws.com/stack": "envoy-gateway-system/preview-gateway",
}
deadline = time.monotonic() + 900
while time.monotonic() < deadline:
    matches = []
    for lb in aws("elbv2", "describe-load-balancers").get("LoadBalancers", []):
        tags = aws("elbv2", "describe-tags", "--resource-arns", lb["LoadBalancerArn"])["TagDescriptions"][0]["Tags"]
        tags = {tag["Key"]: tag["Value"] for tag in tags}
        if all(tags.get(key) == value for key, value in expected.items()):
            matches.append(lb)
    if len(matches) > 1:
        raise RuntimeError("Multiple NLBs match the shared gateway service")
    if matches and matches[0]["State"]["Code"] == "active":
        listeners = aws("elbv2", "describe-listeners", "--load-balancer-arn", matches[0]["LoadBalancerArn"])["Listeners"]
        if any(listener["Port"] == 443 and listener["Protocol"] == "TLS" and
               any(cert["CertificateArn"] == certificate for cert in listener.get("Certificates", []))
               for listener in listeners):
            print("Shared NLB is active with the expected ACM certificate on TLS/443", flush=True)
            break
    time.sleep(5)
else:
    raise TimeoutError("Shared gateway NLB/TLS listener did not become ready within 15 minutes")
