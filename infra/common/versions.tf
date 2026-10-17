terraform {
  required_version = ">= 1.11.0, < 2.0.0"

  # Bucket and role are created by ../bootstrap, then supplied during init.
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
      Stack       = "common"
    }
  }
}

data "aws_partition" "current" {}
