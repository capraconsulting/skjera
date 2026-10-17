resource "helm_release" "operator" {
  name             = "cloudnative-pg"
  namespace        = "cnpg-system"
  create_namespace = true
  repository       = "https://cloudnative-pg.github.io/charts"
  chart            = "cloudnative-pg"
  version          = "0.29.1"
  timeout          = 900
  atomic           = true
  cleanup_on_fail  = true
  wait             = true
  max_history      = 5

  values = [yamlencode({
    config = { clusterWide = true }
    resources = {
      requests = { cpu = "100m", memory = "128Mi" }
      limits   = { memory = "512Mi" }
    }
  })]
}

# Only a storage policy is installed here. CNPG provisions volumes when
# Argo CD applies a Cluster; OpenTofu never creates application databases.
resource "helm_release" "storage" {
  name      = "cnpg-storage"
  namespace = helm_release.operator.namespace
  chart     = "${path.module}/charts/storage"
  version   = "0.1.0"
  values = [yamlencode({
    templateRevision = filesha256("${path.module}/charts/storage/templates/storageclass.yaml")
  })]
  wait    = true
  timeout = 300
}
