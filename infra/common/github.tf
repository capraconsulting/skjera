resource "aws_iam_role" "github_ecr" {
  name                 = "${local.name}-github-ecr"
  description          = "GitHub Actions image publishing only; no cluster or provisioning access."
  max_session_duration = 3600
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = "arn:${data.aws_partition.current.partition}:iam::${var.aws_account_id}:oidc-provider/token.actions.githubusercontent.com" }
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = [
            "${var.github_oidc_subject_prefix}:ref:refs/heads/main",
            "${var.github_oidc_subject_prefix}:pull_request",
          ]
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_ecr" {
  name = "publish-app-image"
  role = aws_iam_role.github_ecr.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "RegistryAuthentication"
        Effect    = "Allow"
        Action    = "ecr:GetAuthorizationToken"
        Resource  = "*"
        Condition = { StringEquals = { "aws:RequestedRegion" = var.aws_region } }
      },
      {
        Sid    = "PublishAppRepository"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer",
          "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage",
        ]
        Resource = aws_ecr_repository.app.arn
      },
    ]
  })
}

output "github_ecr_role_arn" {
  description = "Public identifier for configure-aws-credentials in GitHub Actions; not a secret."
  value       = aws_iam_role.github_ecr.arn
}
