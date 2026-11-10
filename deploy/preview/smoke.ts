/** Publish, verify and remove a disposable OCI preview without a Git push. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { run } from "../automation/process.ts";
import { deploy } from "./smoke-deploy.ts";
import {
  ACCOUNT,
  aws,
  digest,
  ENVIRONMENT,
  get,
  IMAGE_REPO,
  initialize,
  JOURNAL,
  kube,
  LOCAL,
  load,
  ORAS,
  REGION,
  REGISTRY,
  REPOSITORY,
  type Resource,
  ROOT,
  type State,
  save,
} from "./smoke-runtime.ts";

function logged(
  file: string,
  command: string,
  args: string[],
  cwd?: string,
): void {
  const fd = openSync(join(LOCAL, file), "a", 0o600);
  try {
    const result = spawnSync(command, args, { cwd, stdio: ["ignore", fd, fd] });
    if (result.error || result.status !== 0)
      throw new Error(`${command} failed; see private ${file}`);
  } finally {
    closeSync(fd);
  }
}
function build(state: State): void {
  if (state.built) return;
  console.log("Building linux/amd64; see deploy/preview/.local/build.log");
  logged("build.log", "docker", [
    "buildx",
    "build",
    "--platform",
    "linux/amd64",
    "--provenance=false",
    "--sbom=false",
    "--load",
    "--tag",
    `${IMAGE_REPO}:${state.imageTag}`,
    ".",
  ]);
  state.built = true;
  save(state);
}
function publish(state: State): void {
  assert.equal(
    aws<{ Account: string }>("sts", "get-caller-identity").Account,
    ACCOUNT,
  );
  build(state);
  const password = run("aws", [
    "ecr",
    "get-login-password",
    "--region",
    REGION,
  ]);
  const config = join(homedir(), ".docker/config.json");
  const auths = existsSync(config)
    ? (JSON.parse(readFileSync(config, "utf8")).auths ?? {})
    : {};
  state.dockerWasLoggedIn ??= REGISTRY in auths;
  save(state);
  run(
    "docker",
    ["login", "--username", "AWS", "--password-stdin", REGISTRY],
    password,
  );
  if (!state.image) {
    logged("push.log", "docker", ["push", `${IMAGE_REPO}:${state.imageTag}`]);
    state.imageDigest = digest(state.imageTag);
    state.image = `${IMAGE_REPO}@${state.imageDigest}`;
    save(state);
  }
  if (!state.artifactDigest) {
    const archive = join(LOCAL, "manifests.tar.gz");
    run("tar", [
      "-czf",
      archive,
      "-C",
      join(ROOT, "deploy/preview"),
      "main.jsonnet",
      "lib",
    ]);
    const auth = join(LOCAL, "registry.json");
    run(
      "mise",
      [
        ...ORAS,
        "login",
        "--registry-config",
        auth,
        "--username",
        "AWS",
        "--password-stdin",
        REGISTRY,
      ],
      password,
    );
    logged(
      "push.log",
      "mise",
      [
        ...ORAS,
        "push",
        "--registry-config",
        auth,
        `${IMAGE_REPO}:${state.artifactTag}`,
        "manifests.tar.gz:application/vnd.oci.image.layer.v1.tar+gzip",
      ],
      LOCAL,
    );
    state.artifactDigest = digest(state.artifactTag);
    save(state);
  }
  console.log("Published app image and immutable Jsonnet OCI artifact");
}
async function wait(state: State): Promise<void> {
  const k = kube(),
    deadline = Date.now() + 1_500_000;
  let previous = "";
  while (Date.now() < deadline) {
    const status = get(k, "application", state.application, "argocd")?.status;
    const summary = JSON.stringify([
      status?.sync?.status,
      status?.health?.status,
      status?.operationState?.phase,
    ]);
    if (summary !== previous) {
      console.log(`Argo CD status: ${summary}`);
      previous = summary;
    }
    if (
      status?.sync?.status === "Synced" &&
      status.health?.status === "Healthy"
    ) {
      console.log("Preview synced and healthy");
      return;
    }
    if (["Failed", "Error"].includes(status?.operationState?.phase ?? ""))
      throw new Error("Argo sync failed; inspect Application status");
    await setTimeout(10_000);
  }
  throw new Error("Preview did not become healthy within 25 minutes");
}
function verify(state: State): void {
  run("mise", [
    "exec",
    "--",
    "pnpm",
    "--filter",
    "@skjera/app",
    "exec",
    "node",
    "e2e/preview-smoke.ts",
    JOURNAL,
  ]);
  Object.assign(state, JSON.parse(readFileSync(JOURNAL, "utf8")));
  assert(state.uploadedKey);
  assert.equal(
    aws<{ ServerSideEncryption: string }>(
      "s3api",
      "head-object",
      "--bucket",
      state.bucket,
      "--key",
      state.uploadedKey,
    ).ServerSideEncryption,
    "AES256",
  );
  const k = kube();
  const sql =
    "SELECT extversion FROM pg_extension WHERE extname='pg_automerge'; SELECT count(*) FROM oauth_sessions;";
  const result = run("mise", [
    ...k,
    "-n",
    state.namespace,
    "exec",
    "postgres-1",
    "-c",
    "postgres",
    "--",
    "psql",
    "-U",
    "postgres",
    "-d",
    "skjera",
    "-At",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ])
    .toString()
    .trim()
    .split("\n");
  assert(
    result[0] === "0.1.0" && Number(result[1]) > 0,
    "Database extension/session persistence failed",
  );
  const app = get<{ items: Resource[] }>(
    k,
    "pods",
    undefined,
    state.namespace,
  )?.items.find((p) => p.metadata.labels?.app === "app");
  const names = new Set(app?.spec.containers?.[0]?.env.map((e) => e.name));
  assert(
    names.has("AWS_CONTAINER_CREDENTIALS_FULL_URI") &&
      names.has("AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE"),
  );
  for (const name of [
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
  ])
    assert(!names.has(name));
  state.verified = true;
  save(state);
  console.log("PASS: S3 encryption, PostgreSQL persistence and Pod Identity");
}
async function cleanup(state: State): Promise<void> {
  const k = kube(),
    namespace = state.namespace,
    volumes = new Set(state.volumeIds ?? []);
  const claims = get(k, "namespace", namespace)
    ? (get<{ items: Resource[] }>(k, "pvc", undefined, namespace)?.items ?? [])
    : [];
  for (const pvc of claims) {
    const name = pvc.spec.volumeName;
    if (name) {
      const volume = get(k, "pv", name)?.spec.csi?.volumeHandle;
      if (volume) volumes.add(volume);
    }
  }
  state.volumeIds = [...volumes].sort();
  save(state);
  console.log("Deleting the Argo Application with cascading cleanup");
  run("mise", [
    ...k,
    "-n",
    "argocd",
    "delete",
    "application",
    state.application,
    "--ignore-not-found",
    "--timeout=900s",
  ]);
  if (get(k, "namespace", namespace))
    run("mise", [...k, "delete", "namespace", namespace, "--timeout=600s"]);
  assert(!get(k, "namespace", namespace));
  const bucket = spawnSync(
    "aws",
    ["s3api", "head-bucket", "--bucket", state.bucket, "--region", REGION],
    { encoding: "utf8" },
  );
  assert(
    bucket.status !== 0 && bucket.stderr.includes("(404)"),
    "Preview bucket deletion not confirmed",
  );
  for (const volume of volumes) {
    const deadline = Date.now() + 300_000;
    while (true) {
      const result = spawnSync(
        "aws",
        ["ec2", "describe-volumes", "--volume-ids", volume, "--region", REGION],
        { encoding: "utf8" },
      );
      if (
        result.status !== 0 &&
        result.stderr.includes("InvalidVolume.NotFound")
      )
        break;
      assert(
        result.status === 0 && Date.now() < deadline,
        "Preview EBS deletion not confirmed",
      );
      await setTimeout(3000);
    }
  }
  const identities = aws<{ associations: { namespace: string }[] }>(
    "eks",
    "list-pod-identity-associations",
    "--cluster-name",
    `skjera-${ENVIRONMENT}`,
  ).associations;
  assert(
    !identities.some((i) => i.namespace === namespace),
    "Pod Identity remains",
  );
  for (const kind of ["appproject", "secret"])
    run("mise", [
      ...k,
      "-n",
      "argocd",
      "delete",
      kind,
      state.application,
      "--ignore-not-found",
    ]);
  const digests = new Set([
    ...(state.previousDigests ?? []),
    ...[state.artifactDigest, state.imageDigest].filter(
      (d): d is string => !!d,
    ),
  ]);
  for (const d of digests) {
    const result = aws<{ failures?: { failureCode: string }[] }>(
      "ecr",
      "batch-delete-image",
      "--repository-name",
      REPOSITORY,
      "--image-ids",
      `imageDigest=${d}`,
    );
    assert(!result.failures?.some((f) => f.failureCode !== "ImageNotFound"));
  }
  if (state.dockerWasLoggedIn === false) run("docker", ["logout", REGISTRY]);
  for (const tag of [
    ...(state.previousImageTags ?? []),
    ...(state.built ? [state.imageTag] : []),
  ])
    run("docker", ["image", "rm", `${IMAGE_REPO}:${tag}`]);
  for (const file of ["registry.json", "manifests.tar.gz", "browser-error.log"])
    rmSync(join(LOCAL, file), { force: true });
  delete state.password;
  state.cleaned = true;
  save(state);
  console.log(
    "PASS: Preview infrastructure, temporary Argo credentials and smoke artifacts removed",
  );
}
if (import.meta.main) {
  initialize();
  const stage = process.argv[2] ?? "all";
  const commands: Record<string, (s: State) => void | Promise<void>> = {
    build,
    publish,
    deploy,
    wait,
    verify,
    cleanup,
  };
  if (stage !== "all" && !commands[stage])
    throw new Error(
      "Choose all, build, publish, deploy, wait, verify or cleanup",
    );
  // Exclusive lock file with PID recovery for interrupted invocations.
  const lock = join(LOCAL, "run.lock");
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, "utf8"));
    if (Number.isInteger(pid) && pid > 0) {
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
      }
      if (alive) throw new Error("Another smoke command is running");
    }
    rmSync(lock);
  }
  writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
  try {
    const state = load(stage);
    if (state) {
      if (stage === "all") {
        try {
          publish(state);
          deploy(state);
          await wait(state);
          verify(state);
        } finally {
          await cleanup(state);
        }
      } else await commands[stage]?.(state);
    }
  } finally {
    rmSync(lock, { force: true });
  }
}
