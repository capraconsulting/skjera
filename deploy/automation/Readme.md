# PR deployment automation

The pipeline has four stages:

1. `CI` runs checks, sharded browser tests and a container startup test. A
   separate OIDC job publishes successful same-repository PR builds to ECR.
   GitHub Actions stores all intermediate build layers; no ECR build cache is
   downloaded. The image digest and tested PR head are uploaded as data.
2. `PR previews` runs trusted code from `main` after successful CI. It validates
   the artifact against the GitHub run and current PR, then writes desired state
   to private `capraconsulting/skjera-deploy` using a dedicated SSH write deploy key. PR code,
   artifact scripts and fork code are never executed by this workflow.
3. Argo CD's Git-file ApplicationSet renders reviewed Jsonnet plus a per-preview
   SealedSecret. Crossplane owns the bucket and Pod Identity association; CNPG
   owns PostgreSQL. The app uses its own bucket permissions and CNPG secret.
4. A separate job checks public HTTPS until the desired image serves a healthy
   database response. Closing/merging the PR removes desired state, cascading
   deletion of app, bucket, database, secrets and workload identity. A separate
   main-only AWS role removes closed-PR image tags. Hourly reconciliation repairs
   missed close/build events; it cannot recreate expired image artifacts.

Dex remains the temporary login provider: `preview@example.com`, with a random
password held in GitHub's `PREVIEW_DEX_PASSWORD` secret. Signing/client secrets
are unique per preview and stable across image updates. Google SSO remains a
separate integration; wildcard TLS/DNS does not give wildcard OAuth callbacks.

## Activate after reviewing both repositories

The scripts below do not push Git. Until activation, `PREVIEWS_ENABLED` is unset
and the privileged workflow skips its jobs. Existing image publishing remains.

1. Sign in to AWS and GitHub. Review/apply bootstrap (adds object deletion for
   the app's newer image-management feature), common (adds the image cleanup
   role), then Argo CD (installs Sealed Secrets). Leave
   `enable_preview_gitops=false` for this first Argo apply.

   ```bash
   mise exec -- tofu -chdir=infra/bootstrap plan -out=bootstrap.tfplan
   mise exec -- tofu -chdir=infra/bootstrap apply bootstrap.tfplan
   mise exec -- tofu -chdir=infra/common plan -out=common.tfplan
   mise exec -- tofu -chdir=infra/common apply common.tfplan
   mise exec -- tofu -chdir=infra/argocd plan -out=argocd.tfplan
   mise exec -- tofu -chdir=infra/argocd apply argocd.tfplan
   ```

2. Prepare the deployment checkout and export the cluster public certificate:

   ```bash
   mise run preview:prepare ../skjera-deploy
   mise run preview:certificate ../skjera-deploy
   python3 deploy/automation/configure.py backup-keys
   ```

   Review/commit its contents on `main`, then push when ready. No preview entries
   are seeded, so this alone creates no environment. Subsequent template changes
   are also exported and reviewed here; CI never copies templates from PR code.
   The backup command streams private controller keys directly into the existing
   encrypted, versioned state bucket at `argocd/sealed-secrets-keys.json`; it does
   not put them in local files, OpenTofu state or Git. Repeat it after controller
   key renewal and before teardown. On cluster recovery, run
   `python3 deploy/automation/configure.py restore-keys` before installing the
   controller (or restart it afterwards) to preserve existing ciphertext.

3. Enroll CI's dedicated repository write key (requires repository admin access,
   without organization App-registration privileges):

   ```bash
   python3 deploy/automation/configure.py writer
   python3 deploy/automation/configure.py login
   ```

   This registers a write deploy key only on `skjera-deploy` and stores its private
   half in the application repository's `DEPLOY_REPO_SSH_KEY` Actions secret.
   The ignored mode-0600 local key is separate from Argo's read-only key. Checkout
   configures SSH for this repository and removes its temporary credentials after
   the job. Keep the key limited to trusted main-branch automation. It has no
   expiry: rotate it by registering a replacement, updating the Actions secret,
   verifying access, then deleting the old deploy key. No personal token or
   GitHub App is required. Organization policies can still restrict deploy keys.

   `login` sets `PREVIEW_DEX_PASSWORD` once and saves the generated password in
   ignored mode-0600 `deploy/automation/.local/preview-login.json`. An existing
   GitHub login secret is preserved; no password is printed.

4. Give Argo its own **read-only** deploy key (requires GitHub repo admin and
   AWS admin login), then enable the ApplicationSet:

   ```bash
   python3 deploy/automation/configure.py repository
   # Set enable_preview_gitops=true in the tracked
   # infra/argocd/preview.auto.tfvars.json before planning.
   mise exec -- tofu -chdir=infra/argocd plan -out=argocd.tfplan
   mise exec -- tofu -chdir=infra/argocd apply argocd.tfplan
   ```

   Commit that shared activation setting so a new checkout gets the same
   configuration. Do not hide it in local tfvars: disabling the ApplicationSet
   also cascades deletion of its previews. The enrollment command
   registers the public deploy key on GitHub and writes the private key directly
   to an Argo repository Secret. It also keeps an ignored private local copy;
   rerunning reuses it. Argo's built-in GitHub SSH host keys verify the host.

5. Merge the reviewed application branch into `main` when ready. The deployment
   workflow deliberately checks out `main`, so it must exist there before use.
   Then activate it:

   ```bash
   gh variable set PREVIEWS_ENABLED --repo capraconsulting/skjera --body true
   ```

   Open/update a same-repository PR. CI will publish, commit the image digest
   into `skjera-deploy`, and wait for
   `https://pr-N.skjera.capraconsulting.no/health/ready` to return the exact image
   digest in `X-Skjera-Image`. The workflow summary links to the preview. Readiness
   confirms the new image and database; browser login/upload need the acceptance
   verification below. Automation does not seed test data or send real emails.

## Verify and clean up

```bash
mise run preview:test
mise exec shellcheck@0.11.0 actionlint@1.7.12 -- actionlint
mise exec -- tofu -chdir=infra/common test
```

For the first real PR, confirm the OIDC publishing run, GitOps commit, Argo
Synced/Healthy status, Dex login, image upload/list/delete and PostgreSQL data.
Push another commit and confirm the image changes while session/data remain.
Close the PR and confirm Application/Namespace deletion, no remaining Crossplane
bucket/PodIdentityAssociation, no preview bucket or EBS volume, and image tag
cleanup. `mise run preview:smoke` remains a separate disposable full browser/cloud
verification path; it is not proof that GitHub event delivery works.

The cleanup role has deletion permission for the whole app ECR repository;
IAM cannot constrain BatchDeleteImage by image-tag prefix. Trusted cleanup code
only selects the exact `pr-N-sha-<sha>-<run>-<attempt>` pattern and checks GitHub
for a closed PR. It preserves main/unknown tags and all open PR images. Older
pre-pipeline `sha-*` tags require explicit operator review. Existing lifecycle
policy removes untagged leftovers after 14 days.

Before taking down the shared platform, close/remove all previews and wait for
cloud finalizers. Argo, Crossplane, CNPG and Sealed Secrets must remain available
until cleanup finishes. With `enable_preview_gitops=true`, redeployment also
requires restoring its repo credential and publishing a valid sealing certificate;
otherwise use the two-stage activation above.

References: [Argo Git generators](https://argo-cd.readthedocs.io/en/stable/operator-manual/applicationset/Generators-Git/),
[Sealed Secrets](https://github.com/bitnami/sealed-secrets),
[GitHub deploy keys](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys).
