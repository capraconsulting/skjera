variable "aws_region" {
  description = "Region for the state bucket and common infrastructure."
  type        = string
  default     = "eu-north-1"
}

variable "aws_account_id" {
  description = "Expected AWS account ID; the provider refuses other accounts."
  type        = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "Use a 12-digit AWS account ID."
  }
}

variable "environment" {
  description = "Environment shared with the common project."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,19}$", var.environment))
    error_message = "Use 1–20 lowercase letters, numbers or hyphens, starting with a letter."
  }
}

variable "trusted_principal_arns" {
  description = "Existing IAM roles/users allowed to assume the OpenTofu role. Use IAM ARNs, not STS session ARNs."
  type        = set(string)
  validation {
    condition = length(var.trusted_principal_arns) > 0 && alltrue([
      for arn in var.trusted_principal_arns : can(regex("^arn:[^:]+:iam::[0-9]{12}:(role|user)/.+$", arn))
    ])
    error_message = "Provide at least one IAM role or user ARN."
  }
}

locals {
  name              = "skjera-${var.environment}"
  state_bucket_name = "${local.name}-tofu-${var.aws_account_id}-${var.aws_region}"
  state_key         = "common/terraform.tfstate"
  state_keys        = [local.state_key, "argocd/terraform.tfstate", "crossplane/terraform.tfstate", "cloudnativepg/terraform.tfstate", "gateway/terraform.tfstate"]
  iam_prefix        = "arn:${data.aws_partition.current.partition}:iam::${var.aws_account_id}"
  eks_role_arns = [
    "${local.iam_prefix}:role/${local.name}-eks-cluster",
    "${local.iam_prefix}:role/${local.name}-eks-node",
  ]
  eks_policy_arns = [
    for policy in [
      "AmazonEKSClusterPolicy",
      "AmazonEKSComputePolicy",
      "AmazonEKSBlockStoragePolicy",
      "AmazonEKSLoadBalancingPolicy",
      "AmazonEKSNetworkingPolicy",
      "AmazonEKSWorkerNodeMinimalPolicy",
      "AmazonEC2ContainerRegistryPullOnly",
    ] : "arn:${data.aws_partition.current.partition}:iam::aws:policy/${policy}"
  ]
}
