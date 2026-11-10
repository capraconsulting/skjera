# Delegated DNS

This independent project owns the public Route 53 hosted zone
`skjera.capraconsulting.no`. It uses `dns/terraform.tfstate` in the shared S3
backend and assumes the bootstrap-created OpenTofu role. Route 53 is global;
the backend remains in `eu-north-1`. No credentials are stored in this project.

Apply bootstrap first to grant DNS state access and Route 53 permissions, then:

```bash
tofu -chdir=infra/dns init -backend-config=backend.s3.tfbackend
tofu -chdir=infra/dns plan -out=dns.tfplan
tofu -chdir=infra/dns apply dns.tfplan
tofu -chdir=infra/dns output -raw delegation_records
```

## Manual delegation at Domeneshop

In the DNS records for `capraconsulting.no`, add four NS records with host
`skjera`, one for each hostname from `name_servers`, with TTL 3600 if editable.
Use the DNS-record editor (advanced view if needed). These records delegate
only the subdomain; keep the parent domain's existing nameserver settings.
The Route 53 zone already contains its own NS and SOA records.

Verify the parent server returns the delegation:

```bash
dig @ns1.hyp.net skjera.capraconsulting.no NS +norecurse
dig @1.1.1.1 skjera.capraconsulting.no NS
```

Existing recursive caches may take time to expire. The hosted zone delegates
DNS management; app routing is provided by the gateway project, which owns
apex and wildcard A aliases pointing at its NLB.
This project owns a non-exportable ACM certificate for the apex and wildcard,
plus its DNS-validation CNAME. Apply DNS before gateway. ACM renews it
automatically while the validation record remains public and the certificate
is attached to the NLB. Private keys remain in ACM and are never exported
to Kubernetes or OpenTofu state.

It can hold records for the apex and previews such as
`pr-123.skjera.capraconsulting.no`.

## Ownership and teardown

Keep this zone across EKS/common/gateway teardowns so the delegated name servers
stay stable. Retain bootstrap too: the DNS stack still needs its state bucket
and provisioning role. Never empty that bucket while the DNS stack exists.
Deletion is protected by `prevent_destroy`, and `force_destroy`
is disabled. Deliberate DNS retirement requires reviewing the parent delegation
and dependent records, removing the lifecycle guard and destroying this project
before bootstrap. Recreating the zone can change all four name servers and
requires updating the parent delegation again. Back up bootstrap local state
after permission changes; the DNS zone's state is remote.

The provisioning role has account-wide hosted-zone creation, read, tagging and
deletion permissions. Route 53 cannot scope zone creation to an ID that does
not yet exist. The DNS policy grants no record-set writes outside the Skjera
subdomain. Record changes are restricted
to A and CNAME records under that subdomain. Regional ACM permissions allow
certificate management and public certificate reads, with no private-key export.

Reference: [AWS subdomain delegation](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/CreatingNewSubdomain.html).

If creating a replacement zone from scratch, provision the zone first with
`tofu -chdir=infra/dns apply -target=aws_route53_zone.skjera`, publish its
new nameservers at Domeneshop, then run the full DNS plan/apply. This one-time
bootstrap target avoids waiting for certificate validation before delegation
is in place. Normal provisioning and maintenance use full plans.
