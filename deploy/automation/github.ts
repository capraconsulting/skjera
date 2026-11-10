/** Trusted GitHub API access and validation of unprivileged CI metadata. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { output, required, run } from "./process.ts";

export const REPOSITORY = "capraconsulting/skjera";
const IMAGE =
  /^440027025698\.dkr\.ecr\.eu-north-1\.amazonaws\.com\/skjera-dev@sha256:[a-f0-9]{64}$/;
export interface Pull {
  number: number;
  state: string;
  user: { login: string };
  head: { ref: string; sha: string; repo: { full_name: string } | null };
}
export interface Build {
  id: number;
  run_attempt: number;
  event: string;
  conclusion: string;
  head_branch: string;
  head_sha: string;
  head_repository: { full_name: string };
  actor: { login: string };
}
export interface Metadata {
  prNumber: string;
  image: string;
  headSha: string;
  runId: string;
  runAttempt: string;
}

export async function api<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(`https://api.github.com/${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${required("GH_TOKEN")}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${path}`);
  return (await response.json()) as T;
}

export async function* pages<T>(path: string, key?: string): AsyncGenerator<T> {
  for (let page = 1; ; page++) {
    const result = await api<T[] | Record<string, T[]>>(
      `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
    );
    const values = key ? (result as Record<string, T[]>)[key] : (result as T[]);
    if (!Array.isArray(values)) throw new Error("Invalid GitHub page");
    yield* values;
    if (values.length < 100) return;
  }
}

export function eligible(pr: Pull): boolean {
  return (
    pr.state === "open" &&
    pr.head.repo?.full_name === REPOSITORY &&
    pr.user.login !== "dependabot[bot]"
  );
}

export function validate(
  metadata: unknown,
  build: Build,
  pr: Pull,
): metadata is Metadata {
  if (!eligible(pr)) return false;
  if (!metadata || typeof metadata !== "object")
    throw new Error("Invalid image metadata");
  const m = metadata as Metadata;
  if (
    typeof m.image !== "string" ||
    m.image.trim() !== m.image ||
    !IMAGE.test(m.image)
  )
    throw new Error("Image must be an app ECR digest");
  if (
    build.event !== "pull_request" ||
    build.conclusion !== "success" ||
    build.head_repository.full_name !== REPOSITORY ||
    build.actor.login === "dependabot[bot]"
  )
    throw new Error("Only successful same-repository PR builds may deploy");
  if (
    m.prNumber !== String(pr.number) ||
    !/^[1-9][0-9]{0,8}$/.test(m.prNumber) ||
    m.runId !== String(build.id) ||
    m.runAttempt !== String(build.run_attempt) ||
    m.headSha !== build.head_sha ||
    build.head_branch !== pr.head.ref
  )
    throw new Error("Artifact does not match its build and PR");
  return pr.head.sha === m.headSha;
}

export async function imageArtifact(build: Build): Promise<unknown> {
  interface Artifact {
    id: number;
    name: string;
    expired: boolean;
    size_in_bytes: number;
  }
  const artifacts = [];
  for await (const a of pages<Artifact>(
    `repos/${REPOSITORY}/actions/runs/${build.id}/artifacts`,
    "artifacts",
  ))
    if (a.name === "preview-image" && !a.expired) artifacts.push(a);
  const artifact = artifacts[0];
  if (artifacts.length !== 1 || !artifact || artifact.size_in_bytes > 64 * 1024)
    throw new Error("Expected one small non-expired preview-image artifact");
  // gh handles the signed redirect without forwarding the GitHub token. Never extract ZIP paths.
  const zip = run("gh", [
    "api",
    `repos/${REPOSITORY}/actions/artifacts/${artifact.id}/zip`,
  ]);
  const temp = mkdtempSync(join(tmpdir(), "skjera-artifact-"));
  try {
    const file = join(temp, "metadata.zip");
    writeFileSync(file, zip, { mode: 0o600 });
    if (output("unzip", ["-Z1", file]).trim() !== "preview-image.json")
      throw new Error("Unexpected ZIP contents");
    const content = run("unzip", ["-p", file, "preview-image.json"]);
    if (content.length > 4096) throw new Error("Preview metadata is too large");
    return JSON.parse(content.toString());
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
