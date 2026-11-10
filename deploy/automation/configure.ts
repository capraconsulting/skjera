/** Operator enrollment for private repo access and preview login. Never pushes Git. */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPOSITORY } from "./github.ts";
import { token } from "./preview-secrets.ts";
import { run } from "./process.ts";

const LOCAL = join(import.meta.dirname, ".local");
const KEY_BACKUP =
  "s3://skjera-dev-tofu-440027025698-eu-north-1/argocd/sealed-secrets-keys.json";
function local(): void {
  mkdirSync(LOCAL, { recursive: true, mode: 0o700 });
  chmodSync(LOCAL, 0o700);
}
function kubernetes(args: string[], data?: string | Buffer): Buffer {
  const temp = mkdtempSync(join(tmpdir(), "skjera-argocd-kube-"));
  const previous = process.env.KUBECONFIG;
  try {
    const config = join(temp, "config");
    run("aws", [
      "eks",
      "update-kubeconfig",
      "--region",
      "eu-north-1",
      "--name",
      "skjera-dev",
      "--kubeconfig",
      config,
    ]);
    process.env.KUBECONFIG = config;
    return run(
      "mise",
      ["exec", "kubectl@1.35", "--", "kubectl", ...args],
      data,
    );
  } finally {
    if (previous === undefined) delete process.env.KUBECONFIG;
    else process.env.KUBECONFIG = previous;
    rmSync(temp, { recursive: true, force: true });
  }
}
function enroll(writer: boolean): string {
  local();
  const key = join(LOCAL, writer ? "ci-deploy.key" : "argocd-deploy.key");
  if (!existsSync(key))
    run("ssh-keygen", [
      "-q",
      "-t",
      "ed25519",
      "-N",
      "",
      "-C",
      writer ? "skjera-preview-ci-write" : "skjera-dev-argocd-read-only",
      "-f",
      key,
    ]);
  chmodSync(key, 0o600);
  const publicKey = readFileSync(`${key}.pub`, "utf8").trim();
  const keys: { key: string; read_only: boolean }[] = JSON.parse(
    run("gh", ["api", "repos/capraconsulting/skjera-deploy/keys"]).toString(),
  );
  const match = keys.find(
    (k) =>
      k.key.split(/\s+/).slice(0, 2).join(" ") ===
      publicKey.split(/\s+/).slice(0, 2).join(" "),
  );
  if (match && match.read_only === writer)
    throw new Error(
      "Existing deploy key has the wrong access; correct repository enrollment",
    );
  if (!match)
    run(
      "gh",
      [
        "api",
        "--method",
        "POST",
        "repos/capraconsulting/skjera-deploy/keys",
        "--input",
        "-",
      ],
      JSON.stringify({
        title: writer
          ? "skjera preview CI (write)"
          : "skjera-dev Argo CD (read only)",
        key: publicKey,
        read_only: !writer,
      }),
    );
  return key;
}
function repository(): void {
  const key = enroll(false);
  const secret = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: "skjera-deploy",
      namespace: "argocd",
      labels: { "argocd.argoproj.io/secret-type": "repository" },
    },
    stringData: {
      type: "git",
      url: "git@github.com:capraconsulting/skjera-deploy.git",
      sshPrivateKey: readFileSync(key, "utf8"),
    },
  };
  kubernetes(
    [
      "apply",
      "--server-side",
      "--field-manager=skjera-repo-enrollment",
      "-f",
      "-",
    ],
    JSON.stringify(secret),
  );
  console.log(
    "Registered Argo CD's read-only deploy key and repository credential.",
  );
}
function writer(): void {
  const key = enroll(true);
  run(
    "gh",
    ["secret", "set", "DEPLOY_REPO_SSH_KEY", "--repo", REPOSITORY],
    readFileSync(key),
  );
  console.log(
    "Configured the dedicated deployment-repository write key in GitHub Actions.",
  );
}
function backupKeys(): void {
  const data = JSON.parse(
    kubernetes([
      "-n",
      "kube-system",
      "get",
      "secrets",
      "-l",
      "sealedsecrets.bitnami.com/sealed-secrets-key",
      "-o",
      "json",
    ]).toString(),
  );
  if (!data.items.length)
    throw new Error("No controller keys found; refusing to overwrite backup");
  for (const secret of data.items) {
    const { name, namespace, labels } = secret.metadata;
    secret.metadata = { name, namespace, labels };
  }
  run(
    "aws",
    [
      "s3",
      "cp",
      "-",
      KEY_BACKUP,
      "--region",
      "eu-north-1",
      "--sse",
      "AES256",
      "--only-show-errors",
    ],
    JSON.stringify(data),
  );
  console.log(
    "Backed up controller keys to encrypted, versioned private state storage.",
  );
}
function restoreKeys(): void {
  const data = run("aws", [
    "s3",
    "cp",
    KEY_BACKUP,
    "-",
    "--region",
    "eu-north-1",
    "--only-show-errors",
  ]);
  kubernetes(
    [
      "apply",
      "--server-side",
      "--field-manager=skjera-key-recovery",
      "-f",
      "-",
    ],
    data,
  );
  console.log(
    "Restored sealing keys. Restart sealed-secrets-controller if already running.",
  );
}
function login(): void {
  const known: { secrets: { name: string }[] } = JSON.parse(
    run("gh", ["api", `repos/${REPOSITORY}/actions/secrets`]).toString(),
  );
  if (known.secrets.some((s) => s.name === "PREVIEW_DEX_PASSWORD")) {
    console.log("PREVIEW_DEX_PASSWORD exists; keeping existing login.");
    return;
  }
  local();
  const target = join(LOCAL, "preview-login.json");
  if (!existsSync(target))
    writeFileSync(
      target,
      JSON.stringify({ email: "preview@example.com", password: token(32) }),
      { flag: "wx", mode: 0o600 },
    );
  chmodSync(target, 0o600);
  const { password } = JSON.parse(readFileSync(target, "utf8"));
  run(
    "gh",
    ["secret", "set", "PREVIEW_DEX_PASSWORD", "--repo", REPOSITORY],
    password,
  );
  console.log(
    `Configured preview login; credentials are in ignored private file ${target}.`,
  );
}
if (import.meta.main) {
  const commands: Record<string, () => void> = {
    repository,
    writer,
    login,
    "backup-keys": backupKeys,
    "restore-keys": restoreKeys,
  };
  const command = commands[process.argv[2] ?? ""];
  if (!command) throw new Error(`Choose: ${Object.keys(commands).join(", ")}`);
  command();
}
