variable "aws_region" {
  type    = string
  default = "eu-north-1"
}

variable "aws_account_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "Use a 12-digit AWS account ID."
  }
}

variable "environment" {
  type = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,19}$", var.environment))
    error_message = "Use the environment created by common."
  }
}

variable "deployment_role_arn" {
  type = string
  validation {
    condition     = can(regex("^arn:[^:]+:iam::[0-9]{12}:role/.+$", var.deployment_role_arn))
    error_message = "Use bootstrap's OpenTofu IAM role ARN."
  }
}
