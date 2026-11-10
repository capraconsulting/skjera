# Apply ../dns first. Discover public identifiers without reading its state.
data "aws_route53_zone" "skjera" {
  name         = "skjera.capraconsulting.no"
  private_zone = false
}

data "aws_acm_certificate" "gateway" {
  domain      = trimsuffix(data.aws_route53_zone.skjera.name, ".")
  statuses    = ["ISSUED"]
  types       = ["AMAZON_ISSUED"]
  most_recent = true
  tags = {
    Project     = "skjera"
    Environment = var.environment
    Stack       = "dns"
  }
}

# Envoy and Auto Mode create the Service/NLB asynchronously after Helm returns.
resource "terraform_data" "gateway_ready" {
  triggers_replace = [
    data.aws_eks_cluster.main.arn,
    data.aws_acm_certificate.gateway.arn,
    filesha256("${path.module}/charts/shared/templates/gateway.yaml"),
    filesha256("${path.module}/wait_for_gateway.py"),
  ]
  provisioner "local-exec" {
    command = "python3 \"${path.module}/wait_for_gateway.py\""
    environment = {
      GATEWAY_REGION      = var.aws_region
      GATEWAY_CLUSTER     = data.aws_eks_cluster.main.name
      GATEWAY_ROLE_ARN    = var.deployment_role_arn
      GATEWAY_CERTIFICATE = data.aws_acm_certificate.gateway.arn
    }
  }
  depends_on = [helm_release.shared]
}

data "aws_lb" "gateway" {
  tags = {
    "eks:eks-cluster-name"            = data.aws_eks_cluster.main.name
    "service.eks.amazonaws.com/stack" = "envoy-gateway-system/preview-gateway"
  }
  depends_on = [terraform_data.gateway_ready]
}

resource "aws_route53_record" "gateway" {
  for_each = toset(["apex", "wildcard"])
  zone_id  = data.aws_route53_zone.skjera.zone_id
  name     = each.key == "apex" ? data.aws_route53_zone.skjera.name : "*.${trimsuffix(data.aws_route53_zone.skjera.name, ".")}"
  type     = "A"
  alias {
    name                   = data.aws_lb.gateway.dns_name
    zone_id                = data.aws_lb.gateway.zone_id
    evaluate_target_health = false
  }
}

output "public_url" {
  value = "https://${trimsuffix(data.aws_route53_zone.skjera.name, ".")}"
}
