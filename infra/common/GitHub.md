# GitHub Actions to AWS

GitHub Actions uses OIDC and AWS STS to obtain short-lived credentials, without
AWS access keys in GitHub secrets. The bootstrap project owns the account-wide
issuer `https://token.actions.githubusercontent.com`; common owns the
`skjera-dev-github-ecr` publishing role and its repository-scoped policy.
Apply bootstrap before common when changing these resources.

The role accepts the STS audience and exactly two immutable subjects:

```text
repo:capraconsulting@1316242/skjera@1408710589:ref:refs/heads/main
repo:capraconsulting@1316242/skjera@1408710589:pull_request
```

The repository's OIDC settings API confirmed this prefix. New GitHub
repositories use immutable owner/repository IDs; the older
`repo:capraconsulting/skjera:...` format will not authenticate this repository.
The common input `github_oidc_subject_prefix` rejects wildcard patterns.
Repository renames, transfers or subject customization require reviewing trust.
No GitHub OIDC customization or environment is needed for this workflow.

Verify the current GitHub configuration without requesting a token:

```bash
gh api repos/capraconsulting/skjera/actions/oidc/customization/sub
tofu -chdir=infra/common output -raw github_ecr_role_arn
```

## Permissions and workflow

The role can authenticate to ECR in `eu-north-1` and upload/read image layers
and manifests in `skjera-dev`. It cannot create repositories, delete images,
provision infrastructure, access EKS or assume the OpenTofu role. STS sessions
are limited to one hour; the workflow requests 30 minutes. The IAM issuer
handles certificate verification without a hardcoded, manually rotated TLS
thumbprint. Keep this shared issuer if other environments start using it.

`.github/workflows/ci.yml` keeps checks and image builds unprivileged. Once
checks, E2E tests and the image build all pass, a separate publishing job uses
pinned official AWS actions to assume the role and log Docker into ECR.
Same-repository PRs and pushes to main publish; fork and Dependabot PRs remain
build-only. Only the publishing job requests `id-token: write`. The workflow
uses `pull_request`, never `pull_request_target`, for PR code. The workflow
conditions are part of this boundary; repository administrators should preserve
the normal restrictions on write tokens for fork/Dependabot runs.

Tags contain `sha-<commit>-<run-id>-<attempt>`, allowing retries without
replacing immutable ECR tags. The job summary records the deployment reference
`440027025698.dkr.ecr.eu-north-1.amazonaws.com/skjera-dev@sha256:...`.
For PRs, the checked revision is GitHub's tested merge commit, not the PR head
SHA. Future deployment automation should use the recorded image digest.
Publishing alone does not deploy an app or update a GitOps repository.

No AWS secrets or GitHub repository variables need to be added. The role ARN,
region and repository name in the workflow are public identifiers; review them
if creating another environment. These local workflow changes take effect
only once committed and pushed. An actual OIDC exchange can only be verified
by running the updated workflow on GitHub.

## Checks

```bash
mise exec -- tofu -chdir=infra/bootstrap test
mise exec -- tofu -chdir=infra/common test
mise exec actionlint@1.7.12 -- actionlint .github/workflows/ci.yml
```

The OpenTofu tests use mocked providers and create no AWS resources. They check
exact trust subjects, audience, repository-scoped actions and rejection of
wildcard repository identities. AWS IAM simulation can verify allowed ECR
publishing and denied operations without issuing a GitHub token or uploading
an image.

References: [GitHub OIDC subjects](https://docs.github.com/en/actions/reference/security/oidc),
[AWS ECR push permissions](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-push-iam.html).
