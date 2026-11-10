# One GitHub Actions issuer per AWS account. AWS manages issuer certificate
# verification; no manually maintained TLS thumbprint is required.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

output "github_oidc_provider_arn" {
  value = aws_iam_openid_connect_provider.github.arn
}
