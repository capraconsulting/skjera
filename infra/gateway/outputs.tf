output "namespace" {
  value = helm_release.envoy_gateway.namespace
}

output "gateway_name" {
  value = "previews"
}

output "gateway_class" {
  value = "envoy"
}

output "address_command" {
  value = "kubectl -n envoy-gateway-system get gateway previews -o jsonpath='{.status.addresses[0].value}'"
}
