terraform {
  required_version = ">= 1.11.0, < 2.0.0"

  # Bootstrap must remain usable independently of the bucket it creates.
  backend "local" {
    path = "terraform.tfstate"
  }

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

  default_tags {
    tags = {
      Project     = "skjera"
      Environment = var.environment
      ManagedBy   = "OpenTofu"
      Stack       = "bootstrap"
    }
  }
}

data "aws_partition" "current" {}
