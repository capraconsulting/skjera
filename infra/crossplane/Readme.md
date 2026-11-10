# Crossplane

OpenTofu installs Crossplane `2.4.2`, the community AWS S3/family providers
`v2.9.0`, a stable provider service account, an EKS Pod Identity association,
and `ClusterProviderConfig/aws-s3`. The provider packages are explicitly pinned
and installed from `xpkg.crossplane.io/crossplane-contrib`.

**Application buckets are created and destroyed by Crossplane, never OpenTofu.**
OpenTofu owns only the platform controllers and the AWS permissions they use.
Argo CD will apply and remove the per-preview Crossplane resource manifests.

## Provision

Apply bootstrap first when changing AWS permissions, then common (which grants
the OpenTofu role Kubernetes access). Argo CD is deployed independently.
With the trusted Capra SSO administrator login active:

```bash
tofu -chdir=infra/crossplane init -backend-config=backend.s3.tfbackend
tofu -chdir=infra/crossplane validate
tofu -chdir=infra/crossplane plan -out=crossplane.tfplan
tofu -chdir=infra/crossplane apply crossplane.tfplan
```

The shared backend/account files contain identifiers, not keys, and are included
in Git. Operators do not need bootstrap's local state. State lives at
`crossplane/terraform.tfstate` in the existing state bucket, with S3 locking.

The first apply installs three Helm releases in dependency order: core,
provider packages/runtime configuration, then ProviderConfig. The intervening
read-only Python/kubectl wait handles Crossplane's asynchronous CRD registration,
so a fresh install needs no targeted or repeated applies. It uses a temporary
kubeconfig and requires Python 3, AWS CLI and mise (kubectl 1.35 is resolved
through mise). Helm CLI is not required for provisioning.

## AWS identity and permissions

Bootstrap owns `skjera-dev-crossplane-s3`. Its trust policy is restricted to
`provider-aws-s3` in `crossplane-system` on `skjera-dev`. EKS Auto Mode supplies
Pod Identity support; no OIDC provider, access keys or credential Secrets are
needed. ProviderConfig uses `credentials.source: PodIdentity`.

Crossplane may manage buckets named `skjera-dev-app-440027025698-*`, including
bucket settings, and delete objects/versions under that prefix for preview
cleanup. It cannot read or upload objects, access the state bucket, or manage
IAM. The application will need its own separate workload identity with data
access limited to its bucket; do not reuse the Crossplane identity for apps.
IAM name prefixes prevent touching unrelated buckets; namespaces alone do not
isolate AWS permissions between previews.

## GitOps and PR previews

[../../deploy/preview](../../deploy/preview/Readme.md) is a Jsonnet entry point
combining Crossplane storage and CNPG database resources. Each PR supplies its own
`prNumber`; the namespace is derived by default or supplied explicitly. Crossplane creates a private, encrypted
bucket with a unique AWS name and empties/deletes it when its Bucket resource
is removed. No preview or application bucket is created by this OpenTofu stack.

Argo CD's S3 resource health check waits for Crossplane `Ready=True` and
`Synced=True`. The Jsonnet resources place bucket creation in wave -20 and bucket settings
in wave -10, allowing a future app deployment at wave 0 to wait for storage.

The PR ApplicationSet, repository authentication, app manifests/image automation,
preview DNS and application workload identities are later work.
The app's current S3 client also needs support for short-lived AWS credentials
and externally provisioned buckets before deploying it with Pod Identity.

## Lifecycle smoke test

To verify creation, privacy/encryption, object cleanup and deletion end to end:

```bash
python3 infra/crossplane/tests/smoke.py
```

This creates a randomly named disposable preview bucket through Crossplane,
waits for its managed resources, uploads one test object with your current AWS
identity, then removes the Kubernetes resources and confirms AWS returns 404.
It needs Jsonnet (installed through mise) and an admin identity allowed to upload
the test object. It never creates or deletes a bucket using OpenTofu or AWS CLI.
If it fails, it preserves the named namespace for diagnosis; finish cleanup
through Crossplane before removing the controllers or IAM permissions.

## Inspect and teardown

```bash
aws eks update-kubeconfig --region eu-north-1 --name skjera-dev --alias skjera-dev
mise exec kubectl@1.35 -- kubectl -n crossplane-system get pods
mise exec kubectl@1.35 -- kubectl get providers.pkg.crossplane.io
mise exec kubectl@1.35 -- kubectl get clusterproviderconfigs.aws.m.upbound.io
mise exec kubectl@1.35 -- kubectl get buckets.s3.aws.m.upbound.io -A
```

Delete preview resources and wait for their Crossplane finalizers/AWS deletion
before uninstalling providers, Crossplane, the Pod Identity association, or its
IAM role. Keep controllers and permissions available until cleanup completes.
Destroy Crossplane before common; retain bootstrap state and the remote state
bucket. Provider-managed CRDs may remain after Helm uninstall.

References: [Crossplane installation](https://docs.crossplane.io/latest/get-started/install/),
[AWS provider authentication](https://github.com/crossplane-contrib/provider-upjet-aws/blob/v2.9.0/AUTHENTICATION.md).

## Preview workload identities

The AWS EKS provider is installed alongside S3, using its own stable
`provider-aws-eks` service account and Pod Identity role. Its AWS permissions
are limited to Pod Identity association management in this cluster and passing
the shared preview-app role. The provider readiness step waits for both AWS
providers and the PodIdentityAssociation CRD. The historical `aws-s3`
ClusterProviderConfig name is shared by both services; each controller gets
credentials through its own service account.

[Preview Jsonnet](../../deploy/preview/Readme.md) declares each app association.
The shared app role uses EKS session tags to scope object access to its own
bucket and binds service account `pr-N` to namespace `skjera-pr-N`. Crossplane
deletes the association with the preview; no per-PR IAM role is created.
