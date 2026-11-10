/** Check isolation, references and deletion policies without Kubernetes or AWS. */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const image = `440027025698.dkr.ecr.eu-north-1.amazonaws.com/skjera-dev@sha256:${"a".repeat(64)}`;
function render(args: Record<string, string> = {}) {
  return spawnSync(
    "mise",
    [
      "exec",
      "--",
      "jsonnet",
      ...Object.entries(args).flatMap(([k, v]) => ["--tla-str", `${k}=${v}`]),
      "deploy/preview/main.jsonnet",
    ],
    { cwd: root, encoding: "utf8" },
  );
}
// Jsonnet resources are heterogeneous. Test their rendered JSON through records.
type Resource = {
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    annotations: Record<string, string>;
    labels: Record<string, string>;
  };
  spec: Record<string, unknown>;
};
function resources(args: Record<string, string>) {
  const r = render(args);
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout) as Resource[];
}
const spec = (r: Resource | undefined): Record<string, unknown> => {
  if (!r) throw new Error("Missing resource");
  return r.spec;
};
it("isolates namespaces and buckets and connects database/bucket references", () => {
  const first = resources({ prNumber: "123" }),
    second = resources({ prNumber: "124" });
  expect(first).toHaveLength(5);
  expect(new Set(first.map((r) => r.metadata.namespace))).toEqual(
    new Set(["skjera-pr-123"]),
  );
  expect(new Set(second.map((r) => r.metadata.namespace))).toEqual(
    new Set(["skjera-pr-124"]),
  );
  const keyed = Object.fromEntries(first.map((r) => [r.kind, r]));
  const bucket = keyed.Bucket;
  expect(bucket?.metadata.annotations["crossplane.io/external-name"]).toBe(
    "skjera-dev-app-440027025698-pr-123-images",
  );
  expect(
    second.find((r) => r.kind === "Bucket")?.metadata.annotations[
      "crossplane.io/external-name"
    ],
  ).not.toBe(bucket?.metadata.annotations["crossplane.io/external-name"]);
  expect(spec(keyed.Database).cluster).toMatchObject({
    name: keyed.Cluster?.metadata.name,
  });
  for (const kind of [
    "BucketPublicAccessBlock",
    "BucketServerSideEncryptionConfiguration",
  ])
    expect(spec(keyed[kind]).forProvider).toMatchObject({
      bucketRef: { name: bucket?.metadata.name },
    });
});
it("honors overrides and deletes preview storage", () => {
  const items = resources({
    prNumber: "42",
    namespace: "custom-preview",
    environment: "test",
    awsAccountId: "123456789012",
    awsRegion: "eu-west-1",
    postgresStorageSize: "1Gi",
  });
  expect(new Set(items.map((r) => r.metadata.namespace))).toEqual(
    new Set(["custom-preview"]),
  );
  const keyed = Object.fromEntries(items.map((r) => [r.kind, r]));
  expect(spec(keyed.Cluster).storage).toMatchObject({ size: "1Gi" });
  expect(
    keyed.Bucket?.metadata.annotations["crossplane.io/external-name"],
  ).toBe("skjera-test-app-123456789012-pr-42-images");
  expect(spec(keyed.Bucket).forProvider).toMatchObject({ forceDestroy: true });
  expect(spec(keyed.Bucket).managementPolicies).toContain("*");
  expect(spec(keyed.Database).databaseReclaimPolicy).toBe("delete");
  for (const kind of [
    "Bucket",
    "BucketPublicAccessBlock",
    "BucketServerSideEncryptionConfiguration",
  ])
    expect(spec(keyed[kind]).forProvider).toMatchObject({
      region: "eu-west-1",
    });
  for (const kind of ["Bucket", "Cluster"])
    expect(
      keyed[kind]?.metadata.annotations["argocd.argoproj.io/sync-wave"],
    ).toBe("-20");
  for (const kind of [
    "Database",
    "BucketPublicAccessBlock",
    "BucketServerSideEncryptionConfiguration",
  ])
    expect(
      keyed[kind]?.metadata.annotations["argocd.argoproj.io/sync-wave"],
    ).toBe("-10");
});
it("renders app identity, secret references, database and HTTPS", () => {
  const items = resources({ prNumber: "123", image });
  expect(items).toHaveLength(14);
  const find = (kind: string, name: string) =>
    items.find((r) => r.kind === kind && r.metadata.name === name);
  expect(
    find("Namespace", "skjera-pr-123")?.metadata.labels[
      "skjera.capraconsulting.no/preview"
    ],
  ).toBe("true");
  expect(spec(find("Deployment", "app")).template).toMatchObject({
    spec: {
      serviceAccountName: "pr-123",
      containers: [
        {
          env: expect.arrayContaining([
            {
              name: "DATABASE_URL",
              valueFrom: { secretKeyRef: { name: "postgres-app", key: "uri" } },
            },
            {
              name: "SIGNING_SECRET",
              valueFrom: {
                secretKeyRef: { name: "preview-app", key: "signing-secret" },
              },
            },
            { name: "S3_CREATE_BUCKET", value: "false" },
            { name: "APP_IMAGE", value: image },
            {
              name: "OAUTH_ISSUER",
              value: "https://pr-123.skjera.capraconsulting.no/dex",
            },
          ]),
        },
      ],
    },
  });
  expect(spec(find("PodIdentityAssociation", "app")).forProvider).toMatchObject(
    {
      namespace: "skjera-pr-123",
      serviceAccount: "pr-123",
      disableSessionTags: false,
    },
  );
  expect(spec(find("HTTPRoute", "app"))).toMatchObject({
    parentRefs: [expect.objectContaining({ sectionName: "https" })],
    hostnames: ["pr-123.skjera.capraconsulting.no"],
  });
  expect(items.some((r) => r.kind === "Secret")).toBe(false);
  expect(JSON.stringify(items)).not.toContain("S3_ACCESS_KEY_ID");
  const external = resources({
    prNumber: "123",
    image,
    oidcIssuer: "https://login.example.com",
    oidcAllowedDomains: "capraconsulting.no",
  });
  expect(external.some((r) => r.metadata.name === "dex")).toBe(false);
  for (const overrides of [
    { namespace: "other" },
    { image: "image:latest" },
    { image: `image@sha256:${"g".repeat(64)}` },
  ])
    expect(render({ prNumber: "123", image, ...overrides }).status).not.toBe(0);
});
it("rejects invalid inputs and requires an explicit PR number", () => {
  const cases: Record<string, string>[] = [
    ...["", "0", "01", "-1", "1/2", "abc", "1234567890"].map((prNumber) => ({
      prNumber,
    })),
    ...["", "Upper", "bad/name", "-bad", "bad-", "a".repeat(64)].map(
      (namespace) => ({ prNumber: "1", namespace }),
    ),
    { prNumber: "1", awsAccountId: "123" },
    { prNumber: "1", awsAccountId: "12345678901x" },
    { prNumber: "1", environment: "Bad" },
    { prNumber: "1", awsRegion: "" },
    { prNumber: "1", postgresStorageSize: "" },
    {},
  ];
  for (const c of cases)
    expect(render(c).status, JSON.stringify(c)).not.toBe(0);
});
