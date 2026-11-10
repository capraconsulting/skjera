/** Private, resumable state for the optional standalone OCI smoke deployment. */
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { token } from "../automation/preview-secrets.ts";
import { run } from "../automation/process.ts";
export const ROOT = resolve(import.meta.dirname, "../..");
export const LOCAL = join(ROOT, "deploy/preview/.local");
export const JOURNAL = join(LOCAL, "current.json");
const settings = JSON.parse(
  readFileSync(join(ROOT, "infra/common/bootstrap.auto.tfvars.json"), "utf8"),
);
export const REGION: string = settings.aws_region,
  ACCOUNT: string = settings.aws_account_id,
  ENVIRONMENT: string = settings.environment;
export const REGISTRY = `${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com`,
  REPOSITORY = `skjera-${ENVIRONMENT}`,
  IMAGE_REPO = `${REGISTRY}/${REPOSITORY}`;
export const ORAS = ["exec", "oras@1.3.6", "--", "oras"];
export interface State {
  pr: string;
  namespace: string;
  run: string;
  url: string;
  bucket: string;
  application: string;
  imageTag: string;
  artifactTag: string;
  built?: boolean;
  dockerWasLoggedIn?: boolean;
  image?: string;
  imageDigest?: string;
  artifactDigest?: string;
  password?: string;
  email?: string;
  deployed?: boolean;
  verified?: boolean;
  cleaned?: boolean;
  uploadedKey?: string;
  volumeIds?: string[];
  previousDigests?: string[];
  previousImageTags?: string[];
}
export interface Resource {
  metadata: { name: string; labels?: Record<string, string> };
  spec: {
    volumeName?: string;
    csi?: { volumeHandle: string };
    containers?: { env: { name: string }[] }[];
  };
  status?: {
    sync?: { status: string };
    health?: { status: string };
    operationState?: { phase: string };
  };
}
export function initialize(): void {
  process.umask(0o077);
  process.chdir(ROOT);
  mkdirSync(LOCAL, { recursive: true, mode: 0o700 });
  chmodSync(LOCAL, 0o700);
}
export function save(state: State): void {
  writeFileSync(JOURNAL, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(JOURNAL, 0o600);
}
export function load(stage: string): State | undefined {
  const state: State | undefined = existsSync(JOURNAL)
    ? JSON.parse(readFileSync(JOURNAL, "utf8"))
    : undefined;
  if (state && !state.cleaned) return state;
  if (["deploy", "wait", "verify", "cleanup"].includes(stage)) {
    if (stage === "cleanup") {
      console.log("No active preview remains; cleanup is already complete");
      return;
    }
    throw new Error(
      "No active preview; run publish or the full smoke task first",
    );
  }
  const pr = String(randomInt(900_000_000, 999_999_999));
  const id = token(9)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const fresh: State = {
    pr,
    namespace: `skjera-pr-${pr}`,
    run: id,
    url: `https://pr-${pr}.skjera.capraconsulting.no`,
    bucket: `skjera-${ENVIRONMENT}-app-${ACCOUNT}-pr-${pr}-images`,
    application: `skjera-preview-${pr}`,
    imageTag: `preview-smoke-app-${id}`,
    artifactTag: `preview-smoke-config-${id}`,
  };
  save(fresh);
  return fresh;
}
export function aws<T>(...args: string[]): T {
  return JSON.parse(
    run("aws", [...args, "--region", REGION, "--output", "json"]).toString() ||
      "{}",
  );
}
export function kube(): string[] {
  assert.equal(
    aws<{ Account: string }>("sts", "get-caller-identity").Account,
    ACCOUNT,
    "Wrong AWS account",
  );
  const config = join(LOCAL, "kubeconfig");
  run("aws", [
    "eks",
    "update-kubeconfig",
    "--region",
    REGION,
    "--name",
    `skjera-${ENVIRONMENT}`,
    "--kubeconfig",
    config,
  ]);
  chmodSync(config, 0o600);
  return ["exec", "kubectl@1.35", "--", "kubectl", "--kubeconfig", config];
}
export function get<T = Resource>(
  k: string[],
  kind: string,
  name?: string,
  namespace?: string,
): T | undefined {
  const text = run("mise", [
    ...k,
    ...(namespace ? ["-n", namespace] : []),
    "get",
    kind,
    ...(name ? [name] : []),
    "--ignore-not-found",
    "-o",
    "json",
  ])
    .toString()
    .trim();
  return text ? JSON.parse(text) : undefined;
}
export function apply(k: string[], resource: unknown): void {
  run("mise", [...k, "apply", "-f", "-"], JSON.stringify(resource));
}
export function digest(tag: string): string {
  const value = aws<{ imageDetails: { imageDigest: string }[] }>(
    "ecr",
    "describe-images",
    "--repository-name",
    REPOSITORY,
    "--image-ids",
    `imageTag=${tag}`,
  ).imageDetails[0]?.imageDigest;
  assert(value, "No published image digest");
  return value;
}
