/** Prepare a deployment checkout; never push or export cluster private keys. */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { output, run } from "./process.ts";

export const ROOT = resolve(import.meta.dirname, "../..");
export function prepare(destination: string, certificate = false): void {
  destination = resolve(destination);
  if (!existsSync(join(destination, ".git")))
    throw new Error("Clone capraconsulting/skjera-deploy first");
  const remote = output("git", [
    "-C",
    destination,
    "remote",
    "get-url",
    "origin",
  ]).trim();
  if (
    ![
      "git@github.com:capraconsulting/skjera-deploy.git",
      "https://github.com/capraconsulting/skjera-deploy.git",
    ].includes(remote)
  )
    throw new Error("Destination must be the skjera-deploy repository");
  const templates = join(destination, "templates/preview");
  mkdirSync(templates, { recursive: true });
  copyFileSync(
    join(ROOT, "deploy/preview/main.jsonnet"),
    join(templates, "main.jsonnet"),
  );
  cpSync(join(ROOT, "deploy/preview/lib"), join(templates, "lib"), {
    recursive: true,
  });
  mkdirSync(join(destination, "previews"), { recursive: true });
  if (!existsSync(join(destination, "previews/.gitkeep")))
    writeFileSync(join(destination, "previews/.gitkeep"), "");
  mkdirSync(join(destination, "config"), { recursive: true });
  copyFileSync(
    join(ROOT, "deploy/automation/deploy-Readme.md"),
    join(destination, "Readme.md"),
  );
  const ignore = join(destination, ".gitignore");
  const existing = existsSync(ignore)
    ? readFileSync(ignore, "utf8").trimEnd().split("\n")
    : [];
  writeFileSync(
    ignore,
    `${[...new Set([...existing, ".local/", "*.key", "*.pem", ".env", ".env.*"])].join("\n")}\n`,
  );
  if (certificate) {
    const temp = mkdtempSync(join(tmpdir(), "skjera-preview-kube-"));
    try {
      const kubeconfig = join(temp, "config");
      run("aws", [
        "eks",
        "update-kubeconfig",
        "--region",
        "eu-north-1",
        "--name",
        "skjera-dev",
        "--kubeconfig",
        kubeconfig,
      ]);
      // Pass kubeconfig to the subprocess without persisting it in operator config.
      const previous = process.env.KUBECONFIG;
      process.env.KUBECONFIG = kubeconfig;
      let cert: Buffer;
      try {
        cert = run("mise", [
          "exec",
          "--",
          "kubeseal",
          "--fetch-cert",
          "--controller-name",
          "sealed-secrets-controller",
          "--controller-namespace",
          "kube-system",
        ]);
      } finally {
        if (previous === undefined) delete process.env.KUBECONFIG;
        else process.env.KUBECONFIG = previous;
      }
      if (!cert.toString().startsWith("-----BEGIN CERTIFICATE-----"))
        throw new Error("Expected public certificate");
      writeFileSync(join(destination, "config/sealed-secrets.crt"), cert);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
  console.log(
    `Prepared ${destination}; review git diff there before committing or pushing.`,
  );
}
if (import.meta.main) {
  if (!process.argv[2]) throw new Error("Pass deployment checkout path");
  prepare(process.argv[2], process.argv.includes("--certificate"));
}
