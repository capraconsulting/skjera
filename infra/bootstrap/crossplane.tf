# Only the provider runs with this identity. No application bucket is managed
# by OpenTofu; bucket resources belong to Crossplane and the GitOps manifests.
locals {
  app_bucket_prefix = "${local.name}-app-${var.aws_account_id}-"
}

resource "aws_iam_role" "crossplane_s3" {
  name = "${local.name}-crossplane-s3"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "pods.eks.amazonaws.com" }
      Action    = ["sts:AssumeRole", "sts:TagSession"]
      Condition = {
        StringEquals = {
          "aws:RequestTag/eks-cluster-name"           = local.name
          "aws:RequestTag/kubernetes-namespace"       = "crossplane-system"
          "aws:RequestTag/kubernetes-service-account" = "provider-aws-s3"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "crossplane_s3" {
  name = "application-buckets"
  role = aws_iam_role.crossplane_s3.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ManageApplicationBuckets"
        Effect = "Allow"
        Action = [
          "s3:CreateBucket", "s3:DeleteBucket", "s3:GetBucket*", "s3:PutBucket*",
          "s3:ListBucket*", "s3:DeleteBucketPolicy",
          "s3:GetEncryptionConfiguration", "s3:PutEncryptionConfiguration",
          "s3:GetLifecycleConfiguration", "s3:PutLifecycleConfiguration",
          "s3:GetReplicationConfiguration", "s3:PutReplicationConfiguration",
          "s3:GetAccelerateConfiguration", "s3:PutAccelerateConfiguration",
        ]
        Resource = "arn:${data.aws_partition.current.partition}:s3:::${local.app_bucket_prefix}*"
      },
      {
        Sid      = "EmptyPreviewBucketsOnDeletion"
        Effect   = "Allow"
        Action   = ["s3:DeleteObject", "s3:DeleteObjectVersion"]
        Resource = "arn:${data.aws_partition.current.partition}:s3:::${local.app_bucket_prefix}*/*"
      },
    ]
  })
}

resource "aws_iam_role_policy" "crossplane_identity" {
  name = "crossplane-pod-identity"
  role = aws_iam_role.opentofu.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "iam:GetRole"
        Resource = aws_iam_role.crossplane_s3.arn
      },
      {
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = aws_iam_role.crossplane_s3.arn
        Condition = {
          StringEquals = { "iam:PassedToService" = "pods.eks.amazonaws.com" }
        }
      },
    ]
  })
}
