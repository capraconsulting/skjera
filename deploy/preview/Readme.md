# PR preview resources

Argo CD evaluates `main.jsonnet` to deploy an isolated preview at
`https://pr-<number>.skjera.capraconsulting.no`. A shared NLB, wildcard DNS alias
and ACM certificate serve every preview; no DNS/certificate work is needed per PR.

Without an image, rendering produces the existing five bucket/database resources:

```bash
mise run preview:render 123
pnpm --filter @skjera/deploy test:infra
```

Pass a digest-pinned image to include the Namespace, workload identity, app
Deployment, Service, HTTPS route and optional Dex login provider:

```bash
mise exec -- jsonnet --tla-str prNumber=123 \
  --tla-str image=440027025698.dkr.ecr.eu-north-1.amazonaws.com/skjera-dev@sha256:<digest> \
  deploy/preview/main.jsonnet
```

The default deployment contains 14 resources, all in one Argo Application.
Imported `.libsonnet` files are libraries; configure the directory source with
`include: main.jsonnet` so they are not independently evaluated.

## Inputs

| TLA | Default |
| --- | --- |
| `prNumber` | Required positive string, up to nine digits |
| `image` | `null`: bucket/database only; otherwise an immutable `@sha256:` image reference |
| `namespace` | `skjera-pr-<number>`; required to match this pattern when deploying an app |
| `awsAccountId`, `awsRegion`, `environment` | `440027025698`, `eu-north-1`, `dev` |
| `postgresStorageSize` | `5Gi`; the smoke test uses `1Gi` |
| `appSecretName` | `preview-app` |
| `oidcIssuer` | `null`: deploy isolated Dex at the preview's `/dex` path |
| `oidcClientId` | `skjera-preview` |
| `oidcAllowedDomains` | `example.com` for Dex test users |

The app Service listens on port 3000 and its route attaches to the shared
Gateway's `https` listener. The namespace is labelled to permit attachment.
Startup/readiness probes use `/health/ready`; liveness uses `/health`.
Email/Slack integrations are disabled in these previews.

## Database, buckets and workload identity

| Wave | Resources |
| --- | --- |
| -30 | Namespace |
| -20 | Crossplane S3 Bucket and CNPG Cluster |
| -15 | App ServiceAccount `pr-N` |
| -10 | Bucket privacy/encryption, CNPG Database/extension, Pod Identity association |
| -5 | Dex Deployment, Service and `/dex` route, when enabled |
| 0 | App Deployment, Service and route |

Argo health customizations wait for Crossplane Ready/Synced and CNPG readiness
before applying subsequent waves. All resources stay in the same Application;
sync waves do not coordinate independent Applications.

Crossplane exclusively creates and deletes the private, encrypted bucket
`skjera-dev-app-440027025698-pr-N-images`. CNPG owns PostgreSQL 18 and the
`pg_automerge` extension. The app consumes the generated `postgres-app` Secret's
`uri` key as `DATABASE_URL`, connects as the ordinary `skjera` role, and migrates
its own tables. A historical migration skips a redundant extension upgrade when
the installed version already matches the available default, so it does not
require extension ownership. Required extension upgrades still belong to its owner.

Crossplane's EKS provider creates/deletes each `PodIdentityAssociation`.
The shared app IAM role is managed by bootstrap. EKS session tags restrict it to
the bucket matching service account `pr-N`; its trust policy also requires
namespace `skjera-pr-N` in the correct cluster. There is no IAM role per PR to
leak during cleanup. The app can read/write/delete objects and list its own
bucket for the image manager, but cannot create/delete
buckets or access other previews.
Do not reuse either Crossplane provider's identity for application pods.

The app uses the AWS credential chain and refreshes temporary Pod Identity
credentials. No AWS keys are put in manifests. `S3_CREATE_BUCKET=false` leaves
all cloud bucket lifecycle work to Crossplane.

## Secrets and login

Before syncing, provide Secret `preview-app` (or `appSecretName`) in the target
namespace with these keys:

- `signing-secret`: a random, persistent signing secret for this preview.
- `oidc-client-secret`: the secret registered with the OIDC provider.
- `dex-config`: Dex YAML/JSON configuration, only when using the bundled Dex.

Jsonnet contains only secret references. Neither passwords nor client secrets
are included in Git or the OCI manifest artifact. The verification script
creates random credentials and a bcrypt hash with cost 10, which Dex requires.
Dex uses memory storage and exists only for the preview's lifetime. Its only
client callback is that preview's HTTPS `/auth/callback` URL.

For an external/Google-backed provider, set `oidcIssuer`, `oidcClientId` and
`oidcAllowedDomains` (for example `capraconsulting.no`), and provide its client
secret. Dex resources are then omitted. Moving to company Google SSO still
requires provider/broker setup and callback registration; wildcard application
TLS/DNS does not grant wildcard OAuth callback registration.

## Full disposable verification

Provision bootstrap, common, Argo CD, Crossplane (S3 and EKS), CNPG, DNS and
Gateway first. Sign in with the trusted Capra AWS account. You need Docker,
the AWS CLI, Python 3, `htpasswd` with bcrypt support, mise and Playwright:

```bash
mise install
mise exec -- pnpm --filter @skjera/app exec playwright install chromium
mise run preview:smoke
```

This publishes the current working tree's linux/amd64 image to ECR and packages
the Jsonnet libraries as an immutable OCI artifact. Argo CD pulls that artifact
and performs the actual deployment. No Git push or new Git repository is needed
for this single-preview test. A temporary, narrowly configured AppProject and
repository Secret are removed afterwards. The ECR repository token lasts up to
12 hours; this is a disposable verification path, not permanent repository
credential rotation or PR automation.

The test uses a real browser to verify Dex login, a secure session, creation of
a team and publication of an Automerge document. It checks authenticated image
upload, anonymous image read, CSRF/auth rejection, actual S3 encryption,
PostgreSQL extension/session persistence and injected Pod Identity credentials.

The default command attempts cleanup even after a failed check. For diagnosis,
individual stages preserve the preview until explicit cleanup:

```bash
node deploy/preview/smoke.ts publish
node deploy/preview/smoke.ts deploy
node deploy/preview/smoke.ts wait
node deploy/preview/smoke.ts verify
node deploy/preview/smoke.ts cleanup
```

The ignored `.local/` directory contains a mode-0600 journal, private logs and
a verification screenshot. A lock prevents concurrent runs. The test password
is scrubbed and registry credentials removed after cleanup; never commit this
directory. Interrupted runs use the same journal to resume cleanup.

## Cleanup and PR automation

Closing a PR removes its desired state and Argo Application using cascading
deletion. Crossplane empties/deletes the bucket, CNPG removes the database and
PVC, EKS removes the EBS volume, and Crossplane deletes the Pod Identity
association. The Namespace owns the generated secret and Dex state. Keep all
platform controllers running until their finalizers finish; never bypass them.

The smoke script verifies cloud deletion, waits for asynchronous EBS removal,
then removes temporary Argo credentials/project and its published ECR artifacts.
Shared platform infrastructure and roles remain. Preview data is deliberately
disposable; production requires separate retention, availability and backups.

The [automation runbook](../automation/Readme.md) covers the CI-to-GitOps flow,
GitHub App/repository enrollment, Sealed Secrets, the ApplicationSet, readiness
checks and close-event recovery. The manual smoke test remains independent of
GitHub PR events; it does not prove that the automated pipeline is activated.

References: [Argo Jsonnet](https://argo-cd.readthedocs.io/en/stable/user-guide/jsonnet/),
[Argo OCI sources](https://argo-cd.readthedocs.io/en/stable/user-guide/oci/).
