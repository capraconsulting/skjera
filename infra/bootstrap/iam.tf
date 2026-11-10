resource "aws_iam_role" "opentofu" {
  name = "${local.name}-opentofu"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { AWS = sort(tolist(var.trusted_principal_arns)) }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "state" {
  name = "common-state"
  role = aws_iam_role.opentofu.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ListStateBucket"
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:GetBucketLocation"]
        Resource = aws_s3_bucket.state.arn
      },
      {
        Sid      = "ReadWritePlatformState"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = [for key in local.state_keys : "${aws_s3_bucket.state.arn}/${key}"]
      },
      {
        Sid      = "ManagePlatformStateLocks"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = [for key in local.state_keys : "${aws_s3_bucket.state.arn}/${key}.tflock"]
      },
    ]
  })
}

# This is a privileged infrastructure operator, limited to the services used by
# common in the selected region. IAM changes are limited to common's EKS roles
# and its seven AWS-managed policies, plus the ECR publishing role.
# It cannot edit itself or the state bucket.
resource "aws_iam_role_policy" "provision" {
  name = "common-infrastructure"
  role = aws_iam_role.opentofu.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "RegionalInfrastructure"
        Effect   = "Allow"
        Action   = ["ec2:*", "eks:*", "ecr:*", "logs:*"]
        Resource = "*"
        Condition = {
          StringEquals = { "aws:RequestedRegion" = var.aws_region }
        }
      },
      {
        Sid    = "ManageCommonEksRoles"
        Effect = "Allow"
        Action = [
          "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:UpdateRole",
          "iam:UpdateAssumeRolePolicy", "iam:TagRole", "iam:UntagRole",
          "iam:ListRolePolicies", "iam:GetRolePolicy", "iam:ListAttachedRolePolicies",
          "iam:ListInstanceProfilesForRole",
        ]
        Resource = local.eks_role_arns
      },
      {
        Sid    = "ManageGitHubEcrRole"
        Effect = "Allow"
        Action = [
          "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:UpdateRole",
          "iam:UpdateAssumeRolePolicy", "iam:TagRole", "iam:UntagRole",
          "iam:ListRolePolicies", "iam:GetRolePolicy", "iam:ListAttachedRolePolicies",
          "iam:ListInstanceProfilesForRole", "iam:PutRolePolicy", "iam:DeleteRolePolicy",
        ]
        Resource = [
          "${local.iam_prefix}:role/${local.name}-github-ecr",
          "${local.iam_prefix}:role/${local.name}-github-ecr-cleanup",
        ]
      },
      {
        Sid      = "AttachEksManagedPolicies"
        Effect   = "Allow"
        Action   = ["iam:AttachRolePolicy", "iam:DetachRolePolicy"]
        Resource = local.eks_role_arns
        Condition = {
          ArnEquals = { "iam:PolicyARN" = local.eks_policy_arns }
        }
      },
      {
        Sid      = "PassCommonEksRoles"
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = local.eks_role_arns
        Condition = {
          StringEquals = { "iam:PassedToService" = ["eks.amazonaws.com", "ec2.amazonaws.com"] }
        }
      },
      {
        Sid      = "CreateEksServiceLinkedRole"
        Effect   = "Allow"
        Action   = "iam:CreateServiceLinkedRole"
        Resource = "${local.iam_prefix}:role/aws-service-role/eks.amazonaws.com/AWSServiceRoleForAmazonEKS"
        Condition = {
          StringEquals = { "iam:AWSServiceName" = "eks.amazonaws.com" }
        }
      },
    ]
  })
}
