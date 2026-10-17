# PR preview resources

Argo CD evaluates `main.jsonnet` with a PR number to generate one preview's
Crossplane bucket and CloudNativePG database resources. The default namespace
is `skjera-pr-<number>` and the bucket is
`skjera-dev-app-440027025698-pr-<number>-images`.

```bash
mise install
mise run preview:render 123
python3 deploy/preview/tests/render.py
```

The render task prints a JSON array of five Kubernetes resources. It does not
apply them or create AWS resources. Jsonnet is pinned through mise to the Go
implementation/version used by our deployed Argo CD. No Helm CLI or Jsonnet
vendor libraries are needed for preview rendering.

`lib/storage.libsonnet` defines the three S3 resources;
`lib/postgres.libsonnet` defines the CNPG Cluster and Database. `main.jsonnet`
validates inputs and combines them into one resource set. The application
Deployment and PR ApplicationSet are still to be added.

## Argo CD source

Use a directory source pointing to this folder. Pass the PR number as a string
top-level argument (TLA); the future PR ApplicationSet can fill it per PR:

```yaml
spec:
  source:
    repoURL: https://github.com/capraconsulting/skjera.git
    targetRevision: main
    path: deploy/preview
    directory:
      include: main.jsonnet
      jsonnet:
        tlas:
          - name: prNumber
            value: "123"
  destination:
    server: https://kubernetes.default.svc
    namespace: skjera-pr-123
  syncPolicy:
    managedNamespaceMetadata:
      labels:
        skjera.capraconsulting.no/preview: "true"
    syncOptions:
      - CreateNamespace=true
```

This is a source/destination fragment, not a complete Application or
ApplicationSet. Repository authentication, PR discovery, image publishing and
application configuration remain separate work. The namespace label permits
attachment to the [shared gateway](../../infra/gateway/Readme.md). Add the app
Service and per-PR HTTPRoute once its domain is configured. Jsonnet is supported natively
by Argo CD; no config-management plugin is required.

Only `main.jsonnet` is an entry point. Imported files use `.libsonnet` so they
are not evaluated as additional apps. Keep the bucket, database and eventual
app resources in this same Application: sync-wave ordering does not coordinate
independent Applications.

## Inputs

| TLA | Default |
| --- | --- |
| `prNumber` | Required; positive string of up to nine digits |
| `namespace` | `skjera-pr-<prNumber>` |
| `awsAccountId` | `440027025698` |
| `awsRegion` | `eu-north-1` |
| `environment` | `dev` |
| `postgresStorageSize` | `5Gi` |

Overrides use `--tla-str`, for example:

```bash
mise exec -- jsonnet --tla-str prNumber=123 \
  --tla-str namespace=custom-preview --tla-str postgresStorageSize=1Gi \
  deploy/preview/main.jsonnet
```

Namespaces are validated as Kubernetes DNS labels. Account/environment overrides
change rendered names, not platform permissions: the Crossplane provider must
be configured and authorized for the target account and bucket prefix.

## Dependencies and application settings

| Wave | Resources | Readiness |
| --- | --- | --- |
| -20 | S3 Bucket, CNPG Cluster | Crossplane ready/synced; PostgreSQL ready |
| -10 | Bucket privacy/encryption settings, CNPG Database | AWS settings ready; extension applied |
| 0 | Future app resources | Can start after both dependencies |

[Crossplane](../../infra/crossplane/Readme.md) creates and deletes the bucket.
The bucket is private, encrypted, and uses `ClusterProviderConfig/aws-s3` with
EKS Pod Identity. The app's eventual settings are:

- `S3_BUCKET=skjera-dev-app-440027025698-pr-123-images` for PR 123.
- `S3_REGION=eu-north-1` and `S3_ENDPOINT=https://s3.eu-north-1.amazonaws.com`.
- A separate app workload identity restricted to that PR's bucket. Do not reuse
  Crossplane's provider identity. The app's current S3 client still needs support
  for temporary AWS credentials and externally provisioned buckets.

[CloudNativePG](../../infra/cloudnativepg/Readme.md) creates and manages
PostgreSQL 18 on encrypted gp3 storage. It uses the pinned trixie operand and
`pg_automerge` image-volume extension described in
[the extension's CNPG guide](https://theknarf.com/pg-automerge/guide/cloudnativepg).
The Database resource installs `pg_automerge` version `0.1.0` as an administrator,
so the ordinary `skjera` app role can run its startup migrations.

CNPG generates Secret `postgres-app` and read/write service `postgres-rw`.
The future app Deployment can consume its connection URI without copying
credentials into Git or OpenTofu:

```yaml
env:
  - name: DATABASE_URL
    valueFrom:
      secretKeyRef:
        name: postgres-app
        key: uri
```

The PostgreSQL resources use one instance and 2Gi memory with conservative
connection/extension-memory settings. Tune them against real document sizes.
These disposable previews have no HA or backup policy.

## PR closure and cleanup

The future ApplicationSet must remove Applications when PRs close, use
`preserveResourcesOnDeletion: false`, and enable cascading deletion with Argo
CD's resources finalizer. Removing an Application without cascading deletion
would leave preview resources running.

Crossplane's `managementPolicies: ["*"]` and `forceDestroy: true` let it empty
and delete the preview bucket, including uploaded objects/versions. CNPG's
`databaseReclaimPolicy: delete` and the preview StorageClass's `Delete` reclaim
policy allow database/PVC/EBS cleanup. This data is deliberately disposable;
production needs separate retention and backup policies.

Deletion runs in reverse wave order: app first, database/settings next, then
cluster/bucket. Keep Crossplane, CNPG and the EKS storage controller available
until finalizers finish cleanup. Do not bypass finalizers. Namespace separation
alone does not enforce AWS permissions between previews.

The operator lifecycle smoke tests render this same Jsonnet entry point and
select only their own resources:

```bash
python3 infra/crossplane/tests/smoke.py
python3 infra/cloudnativepg/tests/smoke.py
```

References: [Argo CD Jsonnet support](https://argo-cd.readthedocs.io/en/stable/user-guide/jsonnet/).
