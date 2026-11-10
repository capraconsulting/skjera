# Route 53 is global, so these permissions cannot use the regional condition
# in the common policy. CreateHostedZone cannot be scoped to a zone ARN before
# the zone exists. This privileged operator can manage hosted zones account-wide;
# record writes below are limited to the delegated Skjera subdomain.
resource "aws_iam_role_policy" "dns" {
  name = "dns-infrastructure"
  role = aws_iam_role.opentofu.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "CreateAndDiscoverHostedZones"
        Effect   = "Allow"
        Action   = ["route53:CreateHostedZone", "route53:ListHostedZones", "route53:ListHostedZonesByName"]
        Resource = "*"
      },
      {
        Sid    = "ManageHostedZones"
        Effect = "Allow"
        Action = [
          "route53:GetHostedZone", "route53:DeleteHostedZone",
          "route53:ChangeTagsForResource", "route53:ListTagsForResource",
          "route53:ListResourceRecordSets",
        ]
        Resource = "arn:${data.aws_partition.current.partition}:route53:::hostedzone/*"
      },
      {
        Sid      = "ManageSkjeraRecords"
        Effect   = "Allow"
        Action   = "route53:ChangeResourceRecordSets"
        Resource = "arn:${data.aws_partition.current.partition}:route53:::hostedzone/*"
        Condition = {
          "ForAllValues:StringLike" = {
            "route53:ChangeResourceRecordSetsNormalizedRecordNames" = ["skjera.capraconsulting.no", "*.skjera.capraconsulting.no", "\\052.skjera.capraconsulting.no"]
          }
          "ForAllValues:StringEquals" = {
            "route53:ChangeResourceRecordSetsRecordTypes" = ["A", "CNAME"]
          }
        }
      },
      {
        Sid      = "ReadDnsChangeStatus"
        Effect   = "Allow"
        Action   = "route53:GetChange"
        Resource = "arn:${data.aws_partition.current.partition}:route53:::change/*"
      },
    ]
  })
}

resource "aws_iam_role_policy" "certificates" {
  name = "gateway-certificates"
  role = aws_iam_role.opentofu.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "RequestGatewayCertificates"
        Effect    = "Allow"
        Action    = ["acm:RequestCertificate", "acm:ListCertificates"]
        Resource  = "*"
        Condition = { StringEquals = { "aws:RequestedRegion" = var.aws_region } }
      },
      {
        Sid    = "ManageGatewayCertificates"
        Effect = "Allow"
        Action = [
          "acm:DescribeCertificate", "acm:GetCertificate", "acm:DeleteCertificate",
          "acm:ListTagsForCertificate", "acm:AddTagsToCertificate", "acm:RemoveTagsFromCertificate",
        ]
        Resource = "arn:${data.aws_partition.current.partition}:acm:${var.aws_region}:${var.aws_account_id}:certificate/*"
      },
      {
        Sid    = "ReadGatewayLoadBalancer"
        Effect = "Allow"
        Action = [
          "elasticloadbalancing:DescribeLoadBalancers", "elasticloadbalancing:DescribeLoadBalancerAttributes",
          "elasticloadbalancing:DescribeTags", "elasticloadbalancing:DescribeListeners",
        ]
        Resource  = "*"
        Condition = { StringEquals = { "aws:RequestedRegion" = var.aws_region } }
      },
    ]
  })
}
