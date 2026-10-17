output "state_bucket_name" {
  value = aws_s3_bucket.state.id
}

output "opentofu_role_arn" {
  value = aws_iam_role.opentofu.arn
}

output "common_backend_config" {
  description = "Save to ../common/backend.s3.tfbackend and share in Git. Pass to tofu init. Never add credentials."
  value       = <<-EOT
    bucket              = "${aws_s3_bucket.state.id}"
    key                 = "${local.state_key}"
    region              = "${var.aws_region}"
    encrypt             = true
    use_lockfile        = true
    allowed_account_ids = ["${var.aws_account_id}"]
    assume_role = {
      role_arn = "${aws_iam_role.opentofu.arn}"
    }
  EOT
}

output "common_bootstrap_vars" {
  description = "Save to ../common/bootstrap.auto.tfvars.json and share in Git; contains identifiers, not credentials."
  value = jsonencode({
    aws_region          = var.aws_region
    aws_account_id      = var.aws_account_id
    environment         = var.environment
    deployment_role_arn = aws_iam_role.opentofu.arn
  })
}

output "argocd_backend_config" {
  description = "Save to ../argocd/backend.s3.tfbackend and share in Git. Contains identifiers only."
  value       = <<-EOT
    bucket              = "${aws_s3_bucket.state.id}"
    key                 = "argocd/terraform.tfstate"
    region              = "${var.aws_region}"
    encrypt             = true
    use_lockfile        = true
    allowed_account_ids = ["${var.aws_account_id}"]
    assume_role = {
      role_arn = "${aws_iam_role.opentofu.arn}"
    }
  EOT
}
