output "zone_id" {
  description = "Route 53 hosted zone for subsequent app records and certificate validation."
  value       = aws_route53_zone.skjera.zone_id
}

output "zone_name" {
  value = aws_route53_zone.skjera.name
}

output "name_servers" {
  description = "Add all four as NS records for skjera in the parent capraconsulting.no zone."
  value       = sort(aws_route53_zone.skjera.name_servers)
}

output "delegation_records" {
  description = "DNS zone-file representation of the records to enter manually at Domeneshop."
  value       = join("\n", [for ns in sort(aws_route53_zone.skjera.name_servers) : "${trimsuffix(aws_route53_zone.skjera.name, ".")}. 3600 IN NS ${trimsuffix(ns, ".")}."])
}
