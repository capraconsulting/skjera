# Keep this zone across compute teardowns: recreating it can change the
# assigned name servers and require a new delegation in the parent zone.
resource "aws_route53_zone" "skjera" {
  name          = "skjera.capraconsulting.no"
  comment       = "Delegated Skjera subdomain; parent DNS is managed at Domeneshop."
  force_destroy = false

  lifecycle {
    prevent_destroy = true
  }
}
