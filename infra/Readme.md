# AWS infrastructure

Six independent OpenTofu projects targeting Stockholm (`eu-north-1`):

1. [bootstrap](bootstrap): runs with an existing AWS administrator profile and
   local state. Creates a private, versioned, encrypted S3 state bucket and an
   assumable IAM role for OpenTofu, per account/environment.
2. [common](common/Readme.md): assumes that role and keeps state in S3 with
   native locking. Creates networking, EKS Auto Mode and ECR.
3. [argocd](argocd/Readme.md): installs Argo CD through Helm on the existing
   cluster, using a separate S3 state key and the same OpenTofu role.
4. [crossplane](crossplane/Readme.md): installs Crossplane and its S3 provider
   with Pod Identity. Crossplane, not OpenTofu, owns app/preview buckets.
5. [cloudnativepg](cloudnativepg/Readme.md): installs the CNPG operator and
   preview StorageClass. Argo CD declares each app's Cluster and Database.
6. [gateway](gateway/Readme.md): installs Envoy Gateway and a shared public NLB
   listener for per-preview HTTPRoutes. DNS and TLS are configured separately.

The OpenTofu service identity is an IAM role using temporary credentials. The
bootstrap role trusts explicitly configured existing IAM principals. No IAM
users or access keys are created. All projects check the AWS account ID.

## Provision common from a new machine

When bootstrap is provisioned for the Capra account `440027025698` in
`eu-north-1` (`dev`), the following onboarding steps apply. New operators do not need to run bootstrap, obtain its
local state, or regenerate any files. The common project's two shared files contain only
identifiers and are included in Git:

- `common/backend.s3.tfbackend`: state bucket/key, region, account guard and
  the role the backend assumes.
- `common/bootstrap.auto.tfvars.json`: account, region, environment and the
  same role ARN for the AWS provider.

After cloning, install tools with `mise install` and sign in with the AWS CLI
using the Capra SSO **AdministratorAccess** permission set. Choose your local
profile with `AWS_PROFILE` if needed; the default profile works too.

```bash
aws sts get-caller-identity
aws sts assume-role --role-arn arn:aws:iam::440027025698:role/skjera-dev-opentofu \
  --role-session-name common-access-check --query AssumedRoleUser.Arn --output text
cp infra/common/terraform.tfvars.example infra/common/terraform.tfvars
```

Set the remaining common inputs in `terraform.tfvars` as described in
[common/Readme.md](common/Readme.md), then run:

```bash
tofu -chdir=infra/common init -backend-config=backend.s3.tfbackend
tofu -chdir=infra/common validate
tofu -chdir=infra/common plan -out=common.tfplan
tofu -chdir=infra/common apply common.tfplan
```

Each person authenticates independently. No AWS credentials, access keys or
bootstrap state are shared. The existing trust policy names the account's SSO
AdministratorAccess IAM role, so other people signed in through that same
permission set can assume OpenTofu's role. Being an administrator through a
*different* IAM role does not automatically grant access: the bootstrap owner
must add that role to `trusted_principal_arns` and apply bootstrap once.
Do not rerun bootstrap with empty local state to request access.

Keep the original signed-in profile active: the backend and provider each
assume the OpenTofu role themselves. Do not use the OpenTofu role as the source
profile. Session expiry is handled by signing in again with the AWS CLI.

## Bootstrap ownership and new environments

The following steps are for the bootstrap owner creating another environment
or maintaining the bootstrap resources, not for onboarding a new common operator.

Run commands from the repository root with mise active (`mise install` first).
You also need the AWS CLI. Use an existing profile authorized to create the
bootstrap S3 bucket, IAM role and inline policies:

```bash
export AWS_PROFILE=your-admin-profile
aws sts get-caller-identity
cp infra/bootstrap/terraform.tfvars.example infra/bootstrap/terraform.tfvars
```

Edit the example's account ID, environment and `trusted_principal_arns`. For
SSO, use the underlying IAM role ARN (including its path), rather than the STS
session ARN returned by `get-caller-identity`. Each trusted caller must also
be allowed to call `sts:AssumeRole` on the created role; permission boundaries
and organization policies can restrict this even when the trust policy allows it.

```bash
tofu -chdir=infra/bootstrap init
tofu -chdir=infra/bootstrap validate
tofu -chdir=infra/bootstrap plan -out=bootstrap.tfplan
tofu -chdir=infra/bootstrap apply bootstrap.tfplan
```

Bootstrap state stays at `infra/bootstrap/terraform.tfstate`. Securely back up both the state file
and its backup after every apply: the bucket cannot recover the local
state that created it. Keep the bootstrap project on a designated operator's
machine and avoid concurrent bootstrap runs from different copies. Bucket
deletion is protected by `prevent_destroy`; the bucket is never force-emptied.
Old state object versions are retained for recovery, and HTTP access is denied.

## Publish common configuration after bootstrap

After bootstrap succeeds, generate the backend configuration and shared inputs:

```bash
tofu -chdir=infra/bootstrap output -raw common_backend_config > infra/common/backend.s3.tfbackend
tofu -chdir=infra/bootstrap output -raw common_bootstrap_vars > infra/common/bootstrap.auto.tfvars.json
cp infra/common/terraform.tfvars.example infra/common/terraform.tfvars
```

For Argo CD, also publish its backend and shared inputs:

```bash
tofu -chdir=infra/bootstrap output -raw argocd_backend_config > infra/argocd/backend.s3.tfbackend
tofu -chdir=infra/bootstrap output -raw common_bootstrap_vars > infra/argocd/bootstrap.auto.tfvars.json
```

Review and include these generated identifier files in Git so new operators
can use the existing environment. Only these exact common/Argo CD paths are exempted from the
ignore rules; state, plans, local inputs and other backend files remain ignored.
Never add credentials to the shared files. Keep the two files together: they
must refer to the same account/environment. Do not override their account,
environment, region or deployment role in local `terraform.tfvars`.

Set common's Kubernetes version, availability zones, Kubernetes admin principal
and API access CIDRs as described in [common/Readme.md](common/Readme.md).
The Kubernetes admin principal is separate from the OpenTofu provisioning role.
Common also grants the provisioning role cluster admin access so the Argo CD
project can manage cluster components.

Authenticate with one of `trusted_principal_arns` (which can be the bootstrap
profile if it is trusted). Keep this **source** profile in `AWS_PROFILE`:
OpenTofu's S3 backend and AWS provider each assume the bootstrap-created role.
Do not switch `AWS_PROFILE` to the created role itself, which would attempt
role self-assumption.

```bash
export AWS_PROFILE=your-trusted-profile
tofu -chdir=infra/common init -backend-config=backend.s3.tfbackend
tofu -chdir=infra/common validate
tofu -chdir=infra/common plan -out=common.tfplan
tofu -chdir=infra/common apply common.tfplan
```

The common state key is `common/terraform.tfstate` in the environment's bucket.
Native S3 locking (`use_lockfile = true`) coordinates writers; no DynamoDB table
is required. The role can read/write common, Argo CD, Crossplane, CloudNativePG and gateway state and manage their locks, but cannot
configure or delete the bucket. Backend initialization happens before provider
configuration, so role assumption is configured for both independently.

Crossplane and CloudNativePG shared backend/account files are also included in Git. For a
new environment, use the same bucket/account/role settings as Argo CD, with state
keys `crossplane/terraform.tfstate` and `cloudnativepg/terraform.tfstate` respectively. Bootstrap's `state_keys` list grants the
matching state and lock permissions.

The provisioning policy grants broad EC2, EKS, ECR and CloudWatch Logs access in
the chosen region, plus management of the two common EKS roles and attachment
of their seven required AWS-managed policies. It can pass those roles to EKS
and EC2 and create EKS's service-linked role. Treat it as a privileged
infrastructure operator. Bootstrap also creates Crossplane's bucket-scoped runtime role and lets the
OpenTofu role pass it to EKS Pod Identity. It cannot change its own trust or
policies. Additional
services in later stages will require deliberate updates to the bootstrap policy.

## State, environments and existing checkouts

Each environment needs its own bootstrap local state and shared common
configuration. Use separate working directories/checkouts per environment;
do not change environment inputs while reusing another environment's state.
Commit all projects' provider lockfiles. Never commit state or plan files.

Local checks (provider initialization needs no AWS credentials with
`tofu -chdir=<project> init -backend=false`):

```bash
tofu fmt -recursive -check infra
tofu -chdir=infra/bootstrap validate
tofu -chdir=infra/common validate
tofu -chdir=infra/bootstrap test
```

The bootstrap tests use mocked providers and plan only; they do not create AWS
resources or prove live account permissions.

The previous `infra/` project was not applied. For that case, the move to
`infra/common/` needs no state migration; initialize it as above. If you have
since applied the earlier project, preserve its local state and backup before
running anything. Move them into `infra/common/` and initialize with
`tofu -chdir=infra/common init -migrate-state -backend-config=backend.s3.tfbackend`
to transfer the existing state to S3. Resource addresses are unchanged. Review
the subsequent plan: it should not recreate existing infrastructure; the new
`Stack` tag can produce tag updates.

For teardown, let Crossplane/CNPG delete all preview resources and storage,
then remove gateway, CloudNativePG, Crossplane and Argo CD (see [argocd/Readme.md](argocd/Readme.md)),
then destroy common infrastructure (see its Readme). Keep the
bootstrap bucket and state history unless deliberately retiring the environment.
Deleting bootstrap requires explicitly removing the bucket's lifecycle
protection and emptying all object versions, so it is a separate operation.

References: [OpenTofu S3 backend and locking](https://opentofu.org/docs/language/settings/backends/s3/),
[AWS guidance on IAM roles for Terraform](https://docs.aws.amazon.com/prescriptive-guidance/latest/terraform-aws-provider-best-practices/security.html).

## Redeploy after a complete teardown

A complete teardown removes bootstrap too, so onboarding against an existing
backend does not apply until bootstrap is recreated. Keep the ignored local
bootstrap/common input files on the operator's machine; neither state nor
credentials belong in Git. Sign in again with the AWS CLI and verify the account.
Review common's API access CIDRs if the operator's public IP has changed.

Recreate the projects in order: bootstrap, common, argocd, crossplane,
cloudnativepg, gateway. First initialize and apply bootstrap using its local
state. The committed backend/account files remain valid for the same account
and environment. For each remaining project, run:

```bash
tofu -chdir=infra/<project> init -reconfigure -backend-config=backend.s3.tfbackend
tofu -chdir=infra/<project> plan -out=redeploy.tfplan
tofu -chdir=infra/<project> apply redeploy.tfplan
```

For complete retirement, first remove all preview resources while their
controllers are running, then destroy the six projects in reverse order.
Wait for the shared gateway's generated LoadBalancer Service and AWS NLB to
disappear before removing Envoy Gateway. Only after all remote-state projects
are destroyed may the bootstrap owner retire the backend: preserve any desired
state backups outside Git, temporarily disable its bucket `prevent_destroy`,
remove every S3 object version and delete marker, then destroy bootstrap.
Restore the committed bucket protection afterwards. Old saved plan files must
never be reused after teardown; always generate fresh plans.
