# CloudNativePG

OpenTofu installs CloudNativePG operator `1.30.1` through Helm chart `0.29.1`
in `cnpg-system`. A second small Helm release installs the
`cnpg-preview-gp3` StorageClass: encrypted gp3 EBS volumes, EKS Auto Mode's
`ebs.csi.eks.amazonaws.com` driver, delayed binding and volume expansion.
It is explicitly selected by preview clusters and is not the cluster default.

OpenTofu owns the operator and storage policy, not application databases,
credentials, PVCs or volumes. Argo CD applies CNPG `Cluster` and `Database`
resources; CNPG creates and manages PostgreSQL and its Kubernetes resources.
The EKS storage controller provisions and deletes the requested EBS volumes.

## Provision

Common must exist and grant the OpenTofu role Kubernetes admin access.
Bootstrap grants access to this project's state key. With your trusted AWS
login active:

```bash
tofu -chdir=infra/cloudnativepg init -backend-config=backend.s3.tfbackend
tofu -chdir=infra/cloudnativepg validate
tofu -chdir=infra/cloudnativepg plan -out=cloudnativepg.tfplan
tofu -chdir=infra/cloudnativepg apply cloudnativepg.tfplan
```

The shared backend/account files contain identifiers only. State uses
`cloudnativepg/terraform.tfstate` in the existing S3 state bucket, with native
locking and the same OpenTofu role as the other platform projects. A new
operator needs their AWS login, not bootstrap's local state.

## Preview PostgreSQL

[../../deploy/preview](../../deploy/preview/Readme.md) provides
a PostgreSQL 18 cluster and a database with `pg_automerge` installed, using
CNPG's minimal trixie operand and pg-automerge's separate image-volume extension.
Both images are pinned by digest and support amd64 and arm64. EKS 1.35 has
image volumes enabled by default; the current Auto Mode nodes use containerd
2.2, which meets the extension guide's runtime requirement.

The Jsonnet library follows [pg-automerge's CNPG guide](https://theknarf.com/pg-automerge/guide/cloudnativepg).
The regular pg-automerge Docker image remains the local-development image;
CNPG uses the extension-only `pg-automerge-cnpg:0.1.0-18-trixie` image.
A `Database` resource creates the untrusted extension as the database
administrator, allowing the application to run with the ordinary `skjera` role.
CNPG generates the application connection Secret; no password is supplied in
Jsonnet inputs or OpenTofu state.

Argo CD's health checks wait for the Cluster's `Ready` condition and the
Database's applied generation and extensions. Database resources and bucket
resources can be in the same Argo CD Application, with the app following them
at sync wave 0. The PR ApplicationSet and app deployment remain separate work.

## Verify and clean up

```bash
aws eks update-kubeconfig --region eu-north-1 --name skjera-dev --alias skjera-dev
mise exec kubectl@1.35 -- kubectl -n cnpg-system get deployments,pods
mise exec kubectl@1.35 -- kubectl get storageclass cnpg-preview-gp3
python3 infra/cloudnativepg/tests/smoke.py
```

The smoke test creates a randomly named temporary namespace and 1Gi preview
cluster through Kubernetes manifests, verifies extension loading and SQL as the
app role, then removes the Database and Cluster and verifies PVC/EBS deletion.
It prints no credentials. It requires Python 3, AWS CLI and mise. Kubectl is
resolved through mise; Jsonnet is pinned in the repository. Failed tests preserve
their namespace for diagnosis and cleanup.

The preview storage class has `reclaimPolicy: Delete`: deleting preview storage
is permanent. Use a separate retention, replication and backup policy for
production. These single-instance previews have no HA, backup or recovery
configuration. Requests for PostgreSQL storage/nodes incur AWS usage charges.

Remove all app Clusters/Databases and verify PVC/EBS cleanup before uninstalling
the operator or destroying common. Do not remove finalizers to force cleanup.

References: [CNPG Helm installation](https://cloudnative-pg.io/docs/1.30/installation_upgrade/),
[EKS Auto Mode StorageClasses](https://docs.aws.amazon.com/eks/latest/userguide/create-storage-class.html).
