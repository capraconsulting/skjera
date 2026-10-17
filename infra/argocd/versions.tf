terraform {
  required_version = ">= 1.11.0, < 2.0.0"
  backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 3.0"
    }
  }
}

provider "aws" {
  region              = var.aws_region
  allowed_account_ids = [var.aws_account_id]
  assume_role {
    role_arn = var.deployment_role_arn
  }
}

# Discover the existing cluster without reading common's entire state.
data "aws_eks_cluster" "main" {
  name = "skjera-${var.environment}"
}

provider "helm" {
  kubernetes = {
    host                   = data.aws_eks_cluster.main.endpoint
    cluster_ca_certificate = base64decode(data.aws_eks_cluster.main.certificate_authority[0].data)
    exec = {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args = [
        "eks", "get-token", "--region", var.aws_region,
        "--cluster-name", data.aws_eks_cluster.main.name,
        "--role-arn", var.deployment_role_arn,
      ]
    }
  }
}
