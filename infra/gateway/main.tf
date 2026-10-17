resource "helm_release" "envoy_gateway" {
  name             = "envoy-gateway"
  namespace        = "envoy-gateway-system"
  create_namespace = true
  repository       = "oci://docker.io/envoyproxy"
  chart            = "gateway-helm"
  version          = "v1.9.2"
  timeout          = 900
  atomic           = true
  cleanup_on_fail  = true
  wait             = true
  wait_for_jobs    = true
  max_history      = 5
}

resource "helm_release" "shared" {
  name      = "preview-gateway"
  namespace = helm_release.envoy_gateway.namespace
  chart     = "${path.module}/charts/shared"
  version   = "0.1.0"
  values = [yamlencode({
    templateRevision = filesha256("${path.module}/charts/shared/templates/gateway.yaml")
  })]
  timeout = 600
  wait    = true
}
