resource "helm_release" "argocd" {
  name             = "argocd"
  namespace        = "argocd"
  create_namespace = true
  repository       = "https://argoproj.github.io/argo-helm"
  chart            = "argo-cd"
  version          = "10.10.5"

  # Includes time for Auto Mode to provision the first worker nodes.
  timeout         = 1200
  atomic          = true
  cleanup_on_fail = true
  wait            = true
  wait_for_jobs   = true
  max_history     = 5

  values = [file("${path.module}/values.yaml")]
}
