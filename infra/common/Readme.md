# Common AWS foundation

This project uses the bucket and OpenTofu IAM role from [../bootstrap](../bootstrap).
The shared backend configuration and bootstrap identifiers are included in Git.
Follow [../Readme.md](../Readme.md#provision-common-from-a-new-machine) to sign in
and initialize this project. New operators do not need bootstrap's local state
or to run bootstrap themselves.

It creates:

- A VPC with public and private subnets in two availability zones. Nodes use
  private subnets; each zone has its own NAT gateway for outbound traffic.
  Subnet tags let Auto Mode discover public and internal load balancer subnets.
- EKS Auto Mode with the built-in `system` and `general-purpose` node pools,
  managed networking, load balancing and EBS storage capabilities, and required
  IAM roles. Workloads provision nodes as needed.
- Private Kubernetes API access plus a public endpoint restricted to configured
  CIDRs. An explicit IAM principal gets cluster admin access through an EKS
  access entry; the OpenTofu role also has cluster admin access for installing
  Argo CD. The creating identity receives no implicit Kubernetes admin access.
- Control plane logs in CloudWatch with 30-day retention. EKS uses standard
  support, automatically upgrading when standard support ends. Update the
  configured Kubernetes version as you upgrade.
- Private ECR repository `skjera-<environment>` with immutable tags, scan on push
  and encryption. Untagged images expire after 14 days; tagged releases remain.

This stage provides the shared foundation for deploying apps. Workloads,
databases, application buckets, DNS, certificates, StorageClasses and
IngressClasses belong to later stages. Auto Mode's enabled capabilities create
load balancers and volumes only when requested by Kubernetes resources.

## Common inputs

`bootstrap.auto.tfvars.json` supplies the region (`eu-north-1`), account,
environment and deployment role. Edit `terraform.tfvars` for:

- `kubernetes_version`: choose a minor version in standard support in the region.
- `availability_zones`: two distinct standard zones in the same region.
- `admin_principal_arn`: an existing IAM role/user for Kubernetes administration;
  use an IAM ARN, including any path, rather than an STS session ARN.
- `api_access_cidrs`: your office/VPN public IPv4 CIDRs, normally `/32`; replace
  the example IP. Update this if the public IP changes.
- Optionally, `vpc_cidr` if `10.42.0.0/16` overlaps your other networks.

With your trusted source AWS profile:

```bash
aws eks describe-cluster-versions --region eu-north-1 \
  --query 'clusterVersions[?status==`STANDARD_SUPPORT`].clusterVersion'
aws ec2 describe-availability-zones --region eu-north-1 \
  --query 'AvailabilityZones[?ZoneType==`availability-zone`].ZoneName'
```

Applying starts AWS billing: the EKS control plane, two NAT gateways and public
IPv4 addresses have ongoing charges; nodes, Auto Mode management, logs, image
storage and network traffic add usage charges. Review the saved plan before apply.

## Verify

Use the configured Kubernetes admin principal's profile for kubectl (you also
need kubectl installed), substituting your environment suffix for `dev`:

```bash
AWS_PROFILE=your-kubernetes-admin-profile aws eks update-kubeconfig \
  --region eu-north-1 --name skjera-dev --alias skjera-dev
AWS_PROFILE=your-kubernetes-admin-profile kubectl get nodes
AWS_PROFILE=your-kubernetes-admin-profile kubectl get nodepools
```

An empty node list can be normal before workloads are scheduled. To inspect
outputs, use the trusted source AWS profile used for provisioning:

```bash
tofu -chdir=infra/common output -raw ecr_repository_url
tofu -chdir=infra/common output -raw configure_kubectl
```

[GitHub OIDC and ECR publishing](GitHub.md) are configured through bootstrap
and common. The CI workflow publishes successful main and same-repository PR
builds once those workflow changes are pushed. Use unique
release tags (e.g. commit SHAs), because ECR tags cannot be overwritten.

## Teardown

First remove any future Kubernetes resources creating AWS load balancers or
volumes, and explicitly remove ECR images no longer needed. Then use the trusted
source profile to review and destroy:

```bash
tofu -chdir=infra/common plan -destroy -out=destroy.tfplan
tofu -chdir=infra/common apply destroy.tfplan
```

ECR refuses deletion while images remain. The independent bootstrap project
and its bucket survive common teardown, retaining the state history.
