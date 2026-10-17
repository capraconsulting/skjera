output "namespace" {
  value = helm_release.argocd.namespace
}

output "chart_version" {
  value = helm_release.argocd.version
}

output "port_forward" {
  value = "kubectl -n argocd port-forward svc/argocd-server 8080:443 --address 127.0.0.1"
}
