output "namespace" {
  value = helm_release.crossplane.namespace
}

output "provider_config_name" {
  value = "aws-s3"
}

output "application_bucket_prefix" {
  value = "skjera-${var.environment}-app-${var.aws_account_id}-"
}
