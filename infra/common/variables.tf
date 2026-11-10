variable "aws_region" {
  description = "AWS region in which to create the infrastructure."
  type        = string
  default     = "eu-north-1"
}

variable "aws_account_id" {
  description = "Expected AWS account; the provider refuses to use any other account."
  type        = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "Use a 12-digit AWS account ID."
  }
}

variable "deployment_role_arn" {
  description = "OpenTofu role created by bootstrap, assumed by the AWS provider."
  type        = string
  validation {
    condition     = can(regex("^arn:[^:]+:iam::[0-9]{12}:role/.+$", var.deployment_role_arn))
    error_message = "Provide the IAM role ARN output by bootstrap."
  }
}

variable "environment" {
  description = "Environment suffix for resource names, e.g. dev or prod."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,19}$", var.environment))
    error_message = "Use 1–20 lowercase letters, numbers or hyphens, starting with a letter."
  }
}

variable "kubernetes_version" {
  description = "EKS Kubernetes minor version, chosen explicitly from versions supported in the region."
  type        = string
  validation {
    condition     = can(regex("^1\\.[0-9]+$", var.kubernetes_version))
    error_message = "Use a Kubernetes minor version such as 1.35."
  }
}

variable "availability_zones" {
  description = "Two distinct standard availability zones in aws_region."
  type        = list(string)
  validation {
    condition     = length(var.availability_zones) == 2 && length(distinct(var.availability_zones)) == 2
    error_message = "Provide exactly two distinct availability zones."
  }
}

variable "vpc_cidr" {
  description = "IPv4 VPC CIDR; eight equal subnets are reserved, four are created."
  type        = string
  default     = "10.42.0.0/16"
  validation {
    condition     = can(cidrnetmask(var.vpc_cidr)) && can(cidrsubnet(var.vpc_cidr, 3, 7))
    error_message = "Use an IPv4 CIDR that can be divided into eight subnets."
  }
}

variable "admin_principal_arn" {
  description = "Existing IAM role or user ARN granted cluster admin access; not an STS session ARN."
  type        = string
  validation {
    condition     = can(regex("^arn:[^:]+:iam::[0-9]{12}:(role|user)/.+$", var.admin_principal_arn))
    error_message = "Provide an IAM role or user ARN, not an assumed-role session ARN."
  }
}

variable "api_access_cidrs" {
  description = "IPv4 CIDRs allowed to reach the public Kubernetes API, normally office/VPN IPs. Private access is always enabled."
  type        = list(string)
  validation {
    condition     = length(var.api_access_cidrs) > 0 && alltrue([for cidr in var.api_access_cidrs : can(cidrnetmask(cidr)) && cidr != "0.0.0.0/0"])
    error_message = "Provide at least one IPv4 CIDR and restrict access instead of using 0.0.0.0/0."
  }
}

locals {
  name  = "skjera-${var.environment}"
  zones = { for index, zone in var.availability_zones : zone => index }
}

variable "github_oidc_subject_prefix" {
  description = "Exact immutable GitHub OIDC repository identity, verified through its OIDC settings API. No wildcard trust."
  type        = string
  default     = "repo:capraconsulting@1316242/skjera@1408710589"
  validation {
    condition     = can(regex("^repo:[A-Za-z0-9_.-]+@[0-9]+/[A-Za-z0-9_.-]+@[0-9]+$", var.github_oidc_subject_prefix))
    error_message = "Use the exact immutable repo:OWNER@OWNER-ID/REPO@REPO-ID prefix, without wildcard patterns."
  }
}
