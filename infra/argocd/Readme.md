# Argo CD

OpenTofu installs Argo CD on the existing `skjera-dev` EKS cluster through the
Argo Helm chart, pinned to `10.10.5` (Argo CD `3.5.5`). It creates the `argocd`
namespace and a single-instance installation with Redis and ApplicationSet.
Dex and notifications are disabled until SSO and notification destinations are
configured. CPU and memory requests let Auto Mode size the initial workers.
This is a development installation, not a highly available deployment.

## Provision and update

Prerequisites are applied in order: bootstrap, common, then this project.
Bootstrap grants access to this project's state and lock in the existing S3
bucket; common grants the OpenTofu role cluster admin access. The shared backend
and account files contain only identifiers, so a new operator does not need
bootstrap's local state. Sign in using the trusted Capra administrator role:

```bash
tofu -chdir=infra/argocd init -backend-config=backend.s3.tfbackend
tofu -chdir=infra/argocd validate
tofu -chdir=infra/argocd plan -out=argocd.tfplan
tofu -chdir=infra/argocd apply argocd.tfplan
```

The backend assumes `skjera-dev-opentofu` for `argocd/terraform.tfstate` and its
S3 lock. The AWS provider assumes the same role to discover the cluster; the
Helm provider uses `aws eks get-token --role-arn` for renewable Kubernetes
credentials. The current shell must retain the original source AWS login.
No kubeconfig is required by OpenTofu. Your public IP must be in common's
`api_access_cidrs` to reach the Kubernetes API.

Change `values.yaml` or the pinned chart version in `main.tf`, review a plan,
then apply. OpenTofu owns Argo CD and the Sealed Secrets controller (chart
`2.22.0`, controller `0.41.2`). Setting `enable_preview_gitops=true` in the tracked
`preview.auto.tfvars.json` also installs the restricted preview AppProject and
Git-file ApplicationSet. Private repository credentials are enrolled outside
OpenTofu to keep private keys out of state. Follow the
[PR automation runbook](../../deploy/automation/Readme.md) before enabling it.
Disabling/removing the ApplicationSet cascades deletion of its previews.
Do not also have Argo CD manage its own Helm
release without first arranging an ownership migration.

## Access

Configure kubectl with the Capra administrator identity:

```bash
mise run argocd
```

The task configures the `skjera-dev` kubeconfig context and starts port-forwarding.
Sign in to AWS first, setting `AWS_PROFILE` if needed. Stop it with Ctrl+C.

Open **https://localhost:8080**. The server uses its generated self-signed TLS
certificate. No public load balancer or ingress is created. Keep the forwarding
process running while using the UI; it binds only to localhost.

The initial username is `admin`. In your own terminal, retrieve its generated
password (do not paste it into Git, logs or chat):

```bash
mise exec kubectl@1.35 -- kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath='{.data.password}' | base64 --decode
```

Change the password after first login, then delete the initial-password secret
as recommended by Argo CD. The password is generated in Kubernetes, not supplied
as an OpenTofu variable or output. Helm release records and state can still
contain sensitive chart metadata, so state and saved plans remain private.

## Verify and remove

```bash
mise exec kubectl@1.35 -- kubectl -n argocd get deployments,statefulsets,pods,services
```

Check that all expected workloads are ready. To remove Argo CD, review a saved
destroy plan and apply it before destroying common. The chart retains CRDs by
default; check existing Applications/ApplicationSets and their finalizers before
uninstalling, and explicitly decide whether their definitions should be removed.
Argo CD's workloads provision EC2 capacity through Auto Mode and start node
billing even before an app is deployed.

References: [Argo CD Helm installation](https://argo-cd.readthedocs.io/en/stable/operator-manual/installation/),
[Argo Helm chart](https://github.com/argoproj/argo-helm/tree/main/charts/argo-cd).
