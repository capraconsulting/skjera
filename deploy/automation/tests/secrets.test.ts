import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { ensureSecret } from "../preview-secrets.ts";
import { run } from "../process.ts";

it("seals real secrets, keeps sessions stable and rejects a different namespace", () => {
  const root = mkdtempSync(join(tmpdir(), "skjera-seal-test-"));
  try {
    const certificate = join(root, "cert.crt"),
      key = join(root, "private.key");
    run("openssl", [
      "req",
      "-x509",
      "-nodes",
      "-newkey",
      "rsa:2048",
      "-keyout",
      key,
      "-out",
      certificate,
      "-days",
      "1",
      "-subj",
      "/CN=preview-test",
    ]);
    const password = "integration-test-password-never-for-real-use";
    vi.stubEnv("PREVIEW_DEX_PASSWORD", password);
    ensureSecret(root, "123", certificate);
    const target = join(root, "sealed-secret.json"),
      original = readFileSync(target, "utf8");
    expect(original).not.toContain(password);
    vi.stubEnv("PREVIEW_DEX_PASSWORD", "");
    ensureSecret(root, "123", certificate);
    expect(readFileSync(target, "utf8")).toBe(original);
    const args = ["--recovery-unseal", "--recovery-private-key", key];
    const data = Object.fromEntries(
      Object.entries(
        JSON.parse(run("kubeseal", args, original).toString()).data as Record<
          string,
          string
        >,
      ).map(([k, v]) => [k, Buffer.from(v, "base64").toString()]),
    );
    const dex = JSON.parse(data["dex-config"] ?? "{}");
    expect(dex.issuer).toBe("https://pr-123.skjera.capraconsulting.no/dex");
    expect(dex.staticClients[0].secret).toBe(data["oidc-client-secret"]);
    expect(dex.staticPasswords[0].hash).toMatch(/^\$2[aby]\$10\$/);
    expect(data["dex-config"]).not.toContain(password);
    const sealed = JSON.parse(original);
    sealed.metadata.namespace = "skjera-pr-124";
    sealed.spec.template.metadata.namespace = "skjera-pr-124";
    expect(
      spawnSync("kubeseal", args, { input: JSON.stringify(sealed) }).status,
    ).not.toBe(0);
    // Certificate rotation must re-seal instead of reusing an obsolete ciphertext.
    writeFileSync(certificate, `${readFileSync(certificate, "utf8")}\n`);
    vi.stubEnv("PREVIEW_DEX_PASSWORD", password);
    ensureSecret(root, "123", certificate);
    expect(readFileSync(target, "utf8")).not.toBe(original);
  } finally {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});
