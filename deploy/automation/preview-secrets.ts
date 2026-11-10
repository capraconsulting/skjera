/** Namespace-bound SealedSecrets; plaintext never touches disk or stdout. */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./process.ts";

export const token = (bytes: number) =>
  randomBytes(bytes).toString("base64url");
export function secretData(pr: string, password: string) {
  if (password.length < 20 || /[\r\n]/.test(password))
    throw new Error(
      "Set PREVIEW_DEX_PASSWORD to at least 20 characters without newlines",
    );
  const hashed = run(
    "htpasswd",
    ["-niB", "-C", "10", "preview"],
    `${password}\n`,
  )
    .toString()
    .trim()
    .split(":")[1];
  if (!hashed?.startsWith("$2")) throw new Error("Bcrypt generation failed");
  const client = token(32);
  const site = `https://pr-${pr}.skjera.capraconsulting.no`;
  const dex = {
    issuer: `${site}/dex`,
    storage: { type: "memory" },
    web: { http: "0.0.0.0:5556" },
    telemetry: { http: "0.0.0.0:5558" },
    oauth2: { responseTypes: ["code"], skipApprovalScreen: true },
    staticClients: [
      {
        id: "skjera-preview",
        secret: client,
        name: "Skjera preview",
        redirectURIs: [`${site}/auth/callback`],
      },
    ],
    enablePasswordDB: true,
    staticPasswords: [
      {
        email: "preview@example.com",
        username: "preview",
        userID: "skjera-preview",
        hash: hashed,
      },
    ],
  };
  return {
    "signing-secret": token(48),
    "oidc-client-secret": client,
    "dex-config": JSON.stringify(dex),
  };
}

export function ensureSecret(
  directory: string,
  pr: string,
  certificate: string,
): void {
  const target = join(directory, "sealed-secret.json");
  const fingerprint = createHash("sha256")
    .update(readFileSync(certificate))
    .digest("hex");
  const annotation = "skjera.capraconsulting.no/sealing-certificate";
  if (
    existsSync(target) &&
    JSON.parse(readFileSync(target, "utf8")).metadata?.annotations?.[
      annotation
    ] === fingerprint
  )
    return;
  const data = secretData(pr, process.env.PREVIEW_DEX_PASSWORD ?? "");
  const secret = {
    apiVersion: "v1",
    kind: "Secret",
    type: "Opaque",
    metadata: { name: "preview-app", namespace: `skjera-pr-${pr}` },
    data: Object.fromEntries(
      Object.entries(data).map(([k, v]) => [
        k,
        Buffer.from(v).toString("base64"),
      ]),
    ),
  };
  const sealed = JSON.parse(
    run(
      "kubeseal",
      ["--cert", certificate, "--scope", "strict", "--format", "json"],
      JSON.stringify(secret),
    ).toString(),
  );
  sealed.metadata.annotations = {
    "argocd.argoproj.io/sync-wave": "-25",
    [annotation]: fingerprint,
  };
  writeFileSync(target, `${JSON.stringify(sealed, null, 2)}\n`);
}
