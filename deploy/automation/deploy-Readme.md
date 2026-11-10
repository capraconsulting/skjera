# Skjera deployment state

Private desired state for Skjera PR previews in `eu-north-1`.

- `templates/preview`: reviewed Jsonnet templates, exported from the application
  repository with `mise run preview:prepare`. Only maintainers update templates.
- `previews/pr-N/config.json`: CI's digest-pinned image, PR head SHA and run ID.
- `previews/pr-N/sealed-secret.json`: namespace-bound ciphertext for app/Dex secrets.
- `config/sealed-secrets.crt`: the cluster's **public** sealing certificate.

OpenTofu in `capraconsulting/skjera/infra/argocd` owns the restricted AppProject,
ApplicationSet, Argo CD and Sealed Secrets controller. The ApplicationSet reads
`previews/pr-*/config.json` on `main` every minute. Each generated Application
renders the trusted templates and that PR's SealedSecret together. Automated
sync/prune/self-heal keeps the app, database, bucket and workload identity in sync.

Removing a preview directory removes the generated Application. Its finalizer
cascades deletion through Crossplane and CNPG, including bucket contents, Pod
Identity association, PostgreSQL PVC and EBS volume. Keep platform controllers
running until finalizers finish. Preview data is disposable.

CI in the application repository updates only `previews/` after a successful
same-repository PR build. Fork and Dependabot PRs are build-only. It skips stale
commits, reuses secrets across image updates, checks for a PR closing during a
build, and retries Git conflicts without force-pushing. A scheduled job repairs
missed events and removes stale environments. Closed-PR image tags are removed
separately using a default-branch-only AWS role; main images remain.

Argo CD uses a read-only SSH deploy key. CI uses a separate write deploy key
restricted to this repository, with its private half in the application
repository's `DEPLOY_REPO_SSH_KEY` Actions secret. Only trusted main-branch
automation receives it. Checkout removes temporary credentials after each job.
Deploy keys have no expiry; rotate this key manually. The write key can modify
any path in this repository, so review template/platform changes carefully.

No plaintext passwords, signing secrets, cloud keys or private sealing keys
belong in this repository. Sealed Secrets uses strict name/namespace scope.
After rebuilding the cluster, export its new public certificate and rerun CI
for active previews to reseal their disposable secrets. Restoring the previous
controller's private keys also preserves existing ciphertext; store backups in
an approved private store, never Git or OpenTofu variables/state.

For initial enrollment, activation and verification, see
`deploy/automation/Readme.md` in the application repository. This repo is
prepared locally first; preparation never pushes or activates environments.
