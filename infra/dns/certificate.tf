resource "aws_acm_certificate" "gateway" {
  domain_name               = aws_route53_zone.skjera.name
  subject_alternative_names = ["*.${aws_route53_zone.skjera.name}"]
  validation_method         = "DNS"
  key_algorithm             = "RSA_2048"

  # Non-exportable public certificates on ELB have no certificate charge.
  options {
    export = "DISABLED"
  }
  lifecycle {
    create_before_destroy = true
  }
}

# ACM uses the same validation record for an apex and its wildcard. Manage
# the apex entry once, otherwise two resources would own the same CNAME.
resource "aws_route53_record" "certificate_validation" {
  for_each = {
    for option in aws_acm_certificate.gateway.domain_validation_options : option.domain_name => option
    if !startswith(option.domain_name, "*.")
  }
  zone_id = aws_route53_zone.skjera.zone_id
  name    = each.value.resource_record_name
  type    = each.value.resource_record_type
  ttl     = 300
  records = [each.value.resource_record_value]
}

resource "aws_acm_certificate_validation" "gateway" {
  certificate_arn         = aws_acm_certificate.gateway.arn
  validation_record_fqdns = [for record in aws_route53_record.certificate_validation : record.fqdn]
  timeouts {
    create = "15m"
  }
}

output "certificate_arn" {
  description = "DNS-validated regional ACM certificate; retained with DNS for automatic renewal while attached."
  value       = aws_acm_certificate_validation.gateway.certificate_arn
}
