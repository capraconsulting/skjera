variable "enable_preview_gitops" {
  description = "Enable after skjera-deploy main and its Argo repository credential are configured."
  type        = bool
  default     = false
}

resource "helm_release" "sealed_secrets" {
  name            = "sealed-secrets"
  namespace       = "kube-system"
  repository      = "https://bitnami.github.io/sealed-secrets"
  chart           = "sealed-secrets"
  version         = "2.22.0"
  atomic          = true
  cleanup_on_fail = true
  timeout         = 600
  max_history     = 5
  values = [yamlencode({
    fullnameOverride = "sealed-secrets-controller"
    resources = {
      requests = { cpu = "50m", memory = "64Mi" }
      limits   = { memory = "256Mi" }
    }
  })]
}

# OpenTofu owns the restricted project and ApplicationSet. Git only supplies
# preview templates, immutable image digests and namespace-scoped ciphertext.
resource "helm_release" "previews" {
  count           = var.enable_preview_gitops ? 1 : 0
  name            = "skjera-previews"
  namespace       = helm_release.argocd.namespace
  chart           = "${path.module}/charts/previews"
  atomic          = true
  cleanup_on_fail = true
  timeout         = 600
  depends_on      = [helm_release.sealed_secrets]
}
