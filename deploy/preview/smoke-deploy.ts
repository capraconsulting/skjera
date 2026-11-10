import assert from "node:assert/strict";
import { secretData, token } from "../automation/preview-secrets.ts";
import { run } from "../automation/process.ts";
import {
  apply,
  aws,
  get,
  IMAGE_REPO,
  kube,
  type State,
  save,
} from "./smoke-runtime.ts";

export function deploy(state: State): void {
  const k = kube(),
    namespace = state.namespace;
  const existing = get(k, "namespace", namespace);
  if (existing)
    assert.equal(
      existing.metadata.labels?.["skjera.capraconsulting.no/smoke-run"],
      state.run,
      "Namespace belongs to another run",
    );
  else
    run(
      "mise",
      [...k, "create", "-f", "-"],
      JSON.stringify({
        apiVersion: "v1",
        kind: "Namespace",
        metadata: {
          name: namespace,
          labels: {
            "skjera.capraconsulting.no/smoke-run": state.run,
            "skjera.capraconsulting.no/preview": "true",
          },
        },
      }),
    );
  if (!get(k, "secret", "preview-app", namespace)) {
    state.password = token(24);
    state.email = "preview@example.com";
    save(state);
    const secret = {
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: "preview-app", namespace },
      stringData: secretData(state.pr, state.password),
    };
    // Create, rather than apply: no plaintext last-applied annotation.
    run("mise", [...k, "create", "-f", "-"], JSON.stringify(secret));
  }
  const auth = aws<{ authorizationData: { authorizationToken: string }[] }>(
    "ecr",
    "get-authorization-token",
  ).authorizationData[0];
  assert(auth);
  const decoded = Buffer.from(auth.authorizationToken, "base64").toString();
  const colon = decoded.indexOf(":");
  assert(colon > 0);
  const repoSecret = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: state.application,
      namespace: "argocd",
      labels: { "argocd.argoproj.io/secret-type": "repository" },
    },
    stringData: {
      type: "oci",
      url: `oci://${IMAGE_REPO}`,
      username: decoded.slice(0, colon),
      password: decoded.slice(colon + 1),
    },
  };
  run(
    "mise",
    [
      ...k,
      "apply",
      "--server-side",
      "--field-manager=preview-smoke",
      "-f",
      "-",
    ],
    JSON.stringify(repoSecret),
  );
  const allowed = [
    ["", "Service"],
    ["", "ServiceAccount"],
    ["apps", "Deployment"],
    ["gateway.networking.k8s.io", "HTTPRoute"],
    ["postgresql.cnpg.io", "Cluster"],
    ["postgresql.cnpg.io", "Database"],
    ["eks.aws.m.upbound.io", "PodIdentityAssociation"],
    ["s3.aws.m.upbound.io", "Bucket"],
    ["s3.aws.m.upbound.io", "BucketPublicAccessBlock"],
    ["s3.aws.m.upbound.io", "BucketServerSideEncryptionConfiguration"],
  ];
  apply(k, {
    apiVersion: "argoproj.io/v1alpha1",
    kind: "AppProject",
    metadata: { name: state.application, namespace: "argocd" },
    spec: {
      sourceRepos: [`oci://${IMAGE_REPO}`],
      destinations: [{ server: "https://kubernetes.default.svc", namespace }],
      clusterResourceWhitelist: [{ group: "", kind: "Namespace" }],
      namespaceResourceWhitelist: allowed.map(([group, kind]) => ({
        group,
        kind,
      })),
    },
  });
  apply(k, {
    apiVersion: "argoproj.io/v1alpha1",
    kind: "Application",
    metadata: {
      name: state.application,
      namespace: "argocd",
      finalizers: ["resources-finalizer.argocd.argoproj.io"],
    },
    spec: {
      project: state.application,
      source: {
        repoURL: `oci://${IMAGE_REPO}`,
        targetRevision: state.artifactDigest,
        path: ".",
        directory: {
          include: "main.jsonnet",
          jsonnet: {
            tlas: [
              { name: "prNumber", value: state.pr },
              { name: "image", value: state.image },
              { name: "postgresStorageSize", value: "1Gi" },
            ],
          },
        },
      },
      destination: { server: "https://kubernetes.default.svc", namespace },
      syncPolicy: {
        automated: { prune: true, selfHeal: true },
        syncOptions: ["PruneLast=true"],
      },
    },
  });
  state.deployed = true;
  save(state);
  console.log(`Argo CD is deploying ${state.url}`);
}
