# Deletion is available only to trusted main-branch automation, never PR builds.
resource "aws_iam_role" "github_ecr_cleanup" {
  name                 = "${local.name}-github-ecr-cleanup"
  description          = "Trusted default-branch preview image cleanup; no publishing or cluster access."
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
          "token.actions.githubusercontent.com:sub" = "${var.github_oidc_subject_prefix}:ref:refs/heads/main"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_ecr_cleanup" {
  name = "remove-closed-preview-images"
  role = aws_iam_role.github_ecr_cleanup.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ecr:DescribeImages", "ecr:BatchDeleteImage"]
      Resource = aws_ecr_repository.app.arn
    }]
  })
}
