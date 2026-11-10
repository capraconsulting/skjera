# Shared app role; EKS session tags bind each service account pr-N to its own
# bucket. The namespace must match that identity, preventing cross-preview use.
resource "aws_iam_role" "preview_app" {
  name = "${local.name}-preview-app"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "pods.eks.amazonaws.com" }
      Action    = ["sts:AssumeRole", "sts:TagSession"]
      Condition = {
        StringEquals = {
          "aws:RequestTag/eks-cluster-name"     = local.name
          "aws:RequestTag/kubernetes-namespace" = "skjera-$${aws:RequestTag/kubernetes-service-account}"
        }
        StringLike = { "aws:RequestTag/kubernetes-service-account" = "pr-*" }
      }
    }]
  })
}

resource "aws_iam_role_policy" "preview_app" {
  name = "own-preview-images"
  role = aws_iam_role.preview_app.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:GetBucketLocation"]
        Resource = "arn:${data.aws_partition.current.partition}:s3:::${local.app_bucket_prefix}$${aws:PrincipalTag/kubernetes-service-account}-images"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "arn:${data.aws_partition.current.partition}:s3:::${local.app_bucket_prefix}$${aws:PrincipalTag/kubernetes-service-account}-images/*"
      },
    ]
  })
}

resource "aws_iam_role" "crossplane_eks" {
  name = "${local.name}-crossplane-eks"
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
          "aws:RequestTag/kubernetes-service-account" = "provider-aws-eks"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "crossplane_eks" {
  name = "preview-pod-identities"
  role = aws_iam_role.crossplane_eks.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["eks:CreatePodIdentityAssociation", "eks:ListPodIdentityAssociations"]
        Resource = "arn:${data.aws_partition.current.partition}:eks:${var.aws_region}:${var.aws_account_id}:cluster/${local.name}"
      },
      {
        Effect   = "Allow"
        Action   = ["eks:DescribePodIdentityAssociation", "eks:UpdatePodIdentityAssociation", "eks:DeletePodIdentityAssociation", "eks:TagResource", "eks:UntagResource"]
        Resource = "arn:${data.aws_partition.current.partition}:eks:${var.aws_region}:${var.aws_account_id}:podidentityassociation/${local.name}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["iam:GetRole", "iam:PassRole"]
        Resource = aws_iam_role.preview_app.arn
      },
    ]
  })
}

resource "aws_iam_role_policy" "crossplane_eks_identity" {
  name = "crossplane-eks-pod-identity"
  role = aws_iam_role.opentofu.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["iam:GetRole", "iam:PassRole"]
      Resource = aws_iam_role.crossplane_eks.arn
    }]
  })
}
