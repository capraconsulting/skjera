terraform {
  required_version = ">= 1.11.0, < 2.0.0"

  # DNS is independent of EKS and keeps its own remote state.
  backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region              = var.aws_region
  allowed_account_ids = [var.aws_account_id]

  assume_role {
    role_arn = var.deployment_role_arn
  }

  default_tags {
    tags = {
      Project     = "skjera"
      Environment = var.environment
      ManagedBy   = "OpenTofu"
      Stack       = "dns"
    }
  }
}
