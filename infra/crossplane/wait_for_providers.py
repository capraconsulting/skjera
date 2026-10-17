"""Wait for Crossplane's asynchronous package install; do not mutate resources."""

import os
from pathlib import Path
import subprocess
import tempfile

with tempfile.TemporaryDirectory(prefix="skjera-crossplane-") as directory:
    kubeconfig = str(Path(directory) / "kubeconfig")
    subprocess.run(
        [
            "aws", "eks", "update-kubeconfig",
            "--region", os.environ["CROSSPLANE_REGION"],
            "--name", os.environ["CROSSPLANE_CLUSTER"],
            "--role-arn", os.environ["CROSSPLANE_ROLE_ARN"],
            "--kubeconfig", kubeconfig,
        ],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    kubectl = ["mise", "exec", "kubectl@1.35", "--", "kubectl", "--kubeconfig", kubeconfig]
    subprocess.run(
        kubectl + ["wait", "provider.pkg.crossplane.io/provider-family-aws",
                   "provider.pkg.crossplane.io/provider-aws-s3",
                   "--for=condition=Healthy", "--timeout=600s"],
        check=True,
    )
    subprocess.run(
        kubectl + ["wait", "crd/clusterproviderconfigs.aws.m.upbound.io",
                   "crd/buckets.s3.aws.m.upbound.io",
                   "--for=condition=Established", "--timeout=120s"],
        check=True,
    )
