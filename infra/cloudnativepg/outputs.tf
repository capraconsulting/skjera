output "namespace" {
  value = helm_release.operator.namespace
}

output "preview_storage_class" {
  value = "cnpg-preview-gp3"
}
