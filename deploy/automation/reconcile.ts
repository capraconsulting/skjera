/** Update desired state using trusted main code, never PR code. Default: dry run. */
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  api,
  type Build,
  eligible,
  imageArtifact,
  type Metadata,
  type Pull,
  pages,
  REPOSITORY,
  validate,
} from "./github.ts";
import { ensureSecret } from "./preview-secrets.ts";
import { output, required } from "./process.ts";

type Lookup = (number: string) => Promise<Pull>;
export interface Event {
  workflow_run?: { id: number };
  pull_request?: Pull;
}
const git = (directory: string, ...args: string[]) =>
  output("git", ["-C", directory, ...args]);

export async function removeClosed(
  directory: string,
  lookup: Lookup,
): Promise<void> {
  for (const preview of readdirSync(join(directory, "previews"), {
    withFileTypes: true,
  })) {
    if (!preview.isDirectory() && !preview.isSymbolicLink()) continue;
    const match = /^pr-([1-9][0-9]{0,8})$/.exec(preview.name);
    if (!match?.[1] || preview.isSymbolicLink())
      throw new Error(`Unexpected preview directory: ${preview.name}`);
    if (!eligible(await lookup(match[1]))) {
      rmSync(join(directory, "previews", preview.name), { recursive: true });
      console.log(
        `Removed desired state for ${preview.name}; Argo CD will cascade deletion.`,
      );
    }
  }
}

export async function update(
  directory: string,
  metadata: unknown,
  build: Build,
  pr: Pull,
  lookup?: Lookup,
): Promise<Metadata | undefined> {
  if (!validate(metadata, build, pr)) {
    console.log("PR closed or superseded; ignoring build.");
    return;
  }
  const target = join(directory, "previews", `pr-${metadata.prNumber}`);
  const config = join(target, "config.json");
  if (existsSync(config)) {
    const previous: Metadata = JSON.parse(readFileSync(config, "utf8"));
    if (
      BigInt(previous.runId) > BigInt(metadata.runId) ||
      (previous.runId === metadata.runId &&
        Number(previous.runAttempt) > Number(metadata.runAttempt))
    ) {
      console.log(
        "A newer successful build is already recorded; ignoring this run.",
      );
      return;
    }
  }
  mkdirSync(target, { recursive: true });
  ensureSecret(
    target,
    metadata.prNumber,
    join(directory, "config/sealed-secrets.crt"),
  );
  if (lookup && !validate(metadata, build, await lookup(metadata.prNumber))) {
    if (!existsSync(config)) rmSync(target, { recursive: true });
    console.log("PR changed during secret preparation; ignoring build.");
    return;
  }
  writeFileSync(config, `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}

export async function candidates(event: Event): Promise<[unknown, Build][]> {
  if (event.workflow_run) {
    const build = await api<Build>(
      `repos/${REPOSITORY}/actions/runs/${event.workflow_run.id}`,
    );
    return [[await imageArtifact(build), build]];
  }
  if (event.pull_request) return [];
  const result: [unknown, Build][] = [];
  for await (const pr of pages<Pull>(`repos/${REPOSITORY}/pulls?state=open`)) {
    if (!eligible(pr)) continue;
    const runs = await api<{ workflow_runs: Build[] }>(
      `repos/${REPOSITORY}/actions/workflows/ci.yml/runs?event=pull_request&status=success&head_sha=${pr.head.sha}&per_page=1`,
    );
    const build = runs.workflow_runs[0];
    if (build) {
      try {
        result.push([await imageArtifact(build), build]);
      } catch {
        console.log(
          `No usable image artifact for PR ${pr.number}; rerun CI to publish one.`,
        );
      }
    }
  }
  return result;
}

export async function reconcile(
  directory: string,
  event: Event,
  push = false,
): Promise<Metadata | undefined> {
  if ((process.env.GITHUB_REPOSITORY ?? REPOSITORY) !== REPOSITORY)
    throw new Error("Wrong repository");
  if (!existsSync(join(directory, "templates/preview/main.jsonnet")))
    throw new Error("Run mise run preview:prepare first");
  const builds = await candidates(event);
  const lookup: Lookup = (pr) => api(`repos/${REPOSITORY}/pulls/${pr}`);
  for (let attempt = 0; attempt < 3; attempt++) {
    let deployed: Metadata | undefined;
    await removeClosed(directory, lookup);
    for (const [metadata, build] of builds) {
      const number = (metadata as Metadata)?.prNumber;
      if (typeof number !== "string" || !/^[1-9][0-9]{0,8}$/.test(number))
        throw new Error("Invalid artifact PR number");
      deployed = await update(
        directory,
        metadata,
        build,
        await lookup(number),
        lookup,
      );
    }
    await removeClosed(directory, lookup);
    if (
      deployed &&
      !existsSync(
        join(directory, `previews/pr-${deployed.prNumber}/config.json`),
      )
    )
      deployed = undefined;
    if (!push) {
      console.log("Dry run: local desired state updated; no commit or push.");
      return deployed;
    }
    git(directory, "add", "--", "previews");
    const diff = spawnSync("git", [
      "-C",
      directory,
      "diff",
      "--cached",
      "--quiet",
    ]);
    if (diff.status === 0) return deployed;
    if (diff.status !== 1)
      throw new Error("Cannot inspect staged desired state");
    git(
      directory,
      "-c",
      "user.name=skjera-preview[bot]",
      "-c",
      "user.email=skjera-preview[bot]@users.noreply.github.com",
      "commit",
      "-m",
      "Reconcile Skjera PR previews",
    );
    if (
      spawnSync("git", ["-C", directory, "push", "origin", "HEAD:main"], {
        stdio: "inherit",
      }).status === 0
    )
      return deployed;
    if (attempt < 2) {
      git(directory, "fetch", "origin", "main");
      git(directory, "reset", "--hard", "origin/main");
    }
  }
  throw new Error(
    "Deployment repository changed repeatedly; retry reconciliation",
  );
}

export function report(metadata?: Metadata): void {
  if (!metadata) return;
  const url = `https://pr-${metadata.prNumber}.skjera.capraconsulting.no`;
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `Argo CD desired state updated: [${url}](${url})\n\nImage: \`${metadata.image}\`\n`,
    );
  if (process.env.GITHUB_OUTPUT)
    for (const key of ["prNumber", "image", "headSha"] as const)
      appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${metadata[key]}\n`);
}

if (import.meta.main) {
  const directory = process.argv[2];
  if (!directory)
    throw new Error("Pass the deployment repository checkout path");
  const event: Event = JSON.parse(
    readFileSync(required("GITHUB_EVENT_PATH"), "utf8"),
  );
  report(
    await reconcile(resolve(directory), event, process.argv.includes("--push")),
  );
}
