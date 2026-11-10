locals {
  provider_version = "v2.9.0"
  cluster_name     = "skjera-${var.environment}"
}

data "aws_partition" "current" {}

resource "aws_eks_pod_identity_association" "s3" {
  cluster_name    = data.aws_eks_cluster.main.name
  namespace       = "crossplane-system"
  service_account = "provider-aws-s3"
  role_arn        = "arn:${data.aws_partition.current.partition}:iam::${var.aws_account_id}:role/${local.cluster_name}-crossplane-s3"
}

resource "helm_release" "crossplane" {
  name             = "crossplane"
  namespace        = "crossplane-system"
  create_namespace = true
  repository       = "https://charts.crossplane.io/stable"
  chart            = "crossplane"
  version          = "2.4.2"
  timeout          = 900
  atomic           = true
  cleanup_on_fail  = true
  wait             = true
  max_history      = 5
}

resource "helm_release" "aws_providers" {
  name      = "crossplane-aws-providers"
  namespace = helm_release.crossplane.namespace
  chart     = "${path.module}/charts/aws-providers"
  version   = "0.1.0"
  values = [yamlencode({
    providerVersion  = local.provider_version
    templateRevision = filesha256("${path.module}/charts/aws-providers/templates/providers.yaml")
  })]
  timeout = 900
  wait    = true

  depends_on = [aws_eks_pod_identity_association.s3, aws_eks_pod_identity_association.eks]
}

# Provider CRDs are registered asynchronously by Crossplane. Waiting here
# lets a fresh cluster install its ProviderConfig in the same tofu apply.
resource "terraform_data" "providers_ready" {
  triggers_replace = [
    local.provider_version,
    helm_release.crossplane.version,
    filesha256("${path.module}/charts/aws-providers/templates/providers.yaml"),
    filesha256("${path.module}/wait_for_providers.py"),
    data.aws_eks_cluster.main.arn,
  ]

  provisioner "local-exec" {
    command = "python3 \"${path.module}/wait_for_providers.py\""
    environment = {
      CROSSPLANE_REGION   = var.aws_region
      CROSSPLANE_CLUSTER  = data.aws_eks_cluster.main.name
      CROSSPLANE_ROLE_ARN = var.deployment_role_arn
    }
  }

  depends_on = [helm_release.aws_providers]
}

resource "helm_release" "aws_config" {
  name      = "crossplane-aws-config"
  namespace = helm_release.crossplane.namespace
  chart     = "${path.module}/charts/aws-config"
  version   = "0.1.0"
  values = [yamlencode({
    templateRevision = filesha256("${path.module}/charts/aws-config/templates/config.yaml")
  })]
  timeout = 300
  wait    = true

  depends_on = [terraform_data.providers_ready]
}

resource "aws_eks_pod_identity_association" "eks" {
  cluster_name    = data.aws_eks_cluster.main.name
  namespace       = "crossplane-system"
  service_account = "provider-aws-eks"
  role_arn        = "arn:${data.aws_partition.current.partition}:iam::${var.aws_account_id}:role/${local.cluster_name}-crossplane-eks"
}
