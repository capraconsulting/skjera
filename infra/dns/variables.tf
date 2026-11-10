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
