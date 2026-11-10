# Shared Kubernetes gateway

OpenTofu installs Envoy Gateway `v1.9.2`, its bundled Gateway API/Envoy CRDs,
`GatewayClass/envoy`, and `Gateway/previews` in `envoy-gateway-system`.
Envoy manages two proxy replicas and Service `preview-gateway`. EKS Auto Mode
manages the public NLB in front of that service, with IP targets and cross-zone
load balancing. ACM terminates TLS at the NLB on port 443; Envoy receives HTTP inside the VPC.
No separate AWS Load Balancer Controller or AWS access keys
are installed.

Auto Mode's built-in controller does not currently implement Gateway API, so
Envoy translates HTTPRoutes while Auto Mode handles the LoadBalancer service.
One shared NLB serves all previews; each preview will contribute its own route.

## Provision

With bootstrap, DNS (including the issued ACM certificate) and common applied and your trusted AWS login active:

```bash
tofu -chdir=infra/gateway init -backend-config=backend.s3.tfbackend
tofu -chdir=infra/gateway validate
tofu -chdir=infra/gateway plan -out=gateway.tfplan
tofu -chdir=infra/gateway apply gateway.tfplan
```

State uses `gateway/terraform.tfstate` in the existing S3 bucket with locking.
The shared backend/account files contain identifiers only. New operators need
no bootstrap local state. The NLB and proxy nodes have ongoing AWS usage costs.

## Current listener and preview attachment

Public HTTPS uses one non-exportable ACM certificate containing
`skjera.capraconsulting.no` and `*.skjera.capraconsulting.no`. The DNS project
owns the certificate and validation CNAME; ACM automatically renews it while
it remains in use and the validation record is published. No certificate
private key is stored in Kubernetes or OpenTofu state.

This project creates apex and wildcard Route 53 A aliases to the generated
NLB, discovered by cluster/service tags after a read-only readiness wait.
Each PR can use `pr-123.skjera.capraconsulting.no` without creating DNS records
or certificates. The certificate covers one hostname level below the apex.

Port 80 accepts only platform-owned routes and redirects app-domain requests
to HTTPS. Port 443 is the app listener, named `https`. Its Gateway protocol
is intentionally `HTTP`, because TLS terminates at the NLB. A
ClientTrafficPolicy overwrites forwarded scheme/port on this listener and
removes client-supplied Forwarded/X-Forwarded-For headers before Envoy processes
them. App requests see `X-Forwarded-Proto: https` and `X-Forwarded-Port: 443`.
Unmatched HTTPS requests return 404 until an app route is deployed. Argo CD
remains ClusterIP-only.

Only HTTPRoutes from namespaces labelled
`skjera.capraconsulting.no/preview: "true"` may attach. When building the PR
ApplicationSet, use the following Application settings (with each PR's namespace):

```yaml
spec:
  destination:
    server: https://kubernetes.default.svc
    namespace: skjera-pr-123
  syncPolicy:
    managedNamespaceMetadata:
      labels:
        skjera.capraconsulting.no/preview: "true"
    syncOptions:
      - CreateNamespace=true
```

Each route's `parentRefs` should point to:

```yaml
parentRefs:
  - name: previews
    namespace: envoy-gateway-system
    sectionName: https
```

The route and backend Service should live together in the preview namespace;
this needs no cross-namespace backend ReferenceGrant. Add routes to the preview
Jsonnet when the app Service and preview domain are configured. Routes should
use per-PR hostnames to share the listener. Namespace labels control attachment,
not hostname ownership: an untrusted tenant could claim another hostname without
additional policy. Namespace creation/labels and route creation are therefore
platform-controlled operations in this development cluster.

## Inspect and test

```bash
aws eks update-kubeconfig --region eu-north-1 --name skjera-dev --alias skjera-dev
mise exec kubectl@1.35 -- kubectl get gatewayclass envoy
mise exec kubectl@1.35 -- kubectl -n envoy-gateway-system get gateway,pods,svc
mise exec kubectl@1.35 -- kubectl -n envoy-gateway-system get gateway previews -o jsonpath='{.status.addresses[0].value}'
python3 infra/gateway/tests/smoke.py
```

The smoke test creates a temporary HTTP echo service and route for the apex
and a newly generated wildcard hostname. It verifies namespace attachment
isolation, normal TLS trust/hostname validation, routing to the backend,
HTTP-to-HTTPS redirects with path/query preservation, and sanitized forwarding
headers even when clients send spoofed values. No DNS records or certificates
are created by the test. The temporary namespace is deleted on success and
preserved on failure for diagnosis. It requires the AWS CLI, Python 3, mise
and access to the public Kubernetes API.

## Upgrades and teardown

Review Envoy's compatibility matrix before changing its pinned version.
Helm does not upgrade CRDs installed under `crds/`: follow Envoy's documented
CRD upgrade procedure before upgrading the controller. Deleting the controller
Helm release leaves CRDs; never delete shared Gateway API CRDs while routes exist.

Remove application routes first, then destroy this project before common.
Its DNS aliases are removed with the gateway; retain the DNS project,
certificate and bootstrap backend across compute teardowns. Certificate
renewal requires the certificate to be attached to an active AWS service.
The shared release removes the Gateway, allowing Envoy and EKS Auto Mode to
remove the proxy Service and NLB while the controller is still installed.
Verify the AWS load balancer is gone before destroying the VPC. Do not remove
load-balancer finalizers to force deletion.

References: [Envoy Helm installation](https://gateway.envoyproxy.io/docs/install/install-helm/),
[EnvoyProxy customization](https://gateway.envoyproxy.io/docs/tasks/operations/customize-envoyproxy/),
[EKS Auto Mode NLBs](https://docs.aws.amazon.com/eks/latest/userguide/auto-configure-nlb.html),
[Auto Mode release notes](https://docs.aws.amazon.com/eks/latest/userguide/auto-change.html).
