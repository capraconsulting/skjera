import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closedTags } from "../cleanup-images.ts";
import { api, imageArtifact, pages, validate } from "../github.ts";
import { ensureSecret } from "../preview-secrets.ts";
import { output } from "../process.ts";
import { candidates, reconcile, removeClosed, update } from "../reconcile.ts";
import { fixture } from "./fixtures.ts";

vi.mock("../preview-secrets.ts", () => ({ ensureSecret: vi.fn() }));
vi.mock("../github.ts", async (original) => ({
  ...(await original<typeof import("../github.ts")>()),
  api: vi.fn(),
  pages: vi.fn(),
  imageArtifact: vi.fn(),
}));
let root: string;
beforeEach(() => {
  vi.resetAllMocks();
  root = mkdtempSync(join(tmpdir(), "skjera-reconcile-"));
  mkdirSync(join(root, "previews"));
  mkdirSync(join(root, "templates/preview"), { recursive: true });
  writeFileSync(join(root, "templates/preview/main.jsonnet"), "[]");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("artifact trust boundaries", () => {
  it("accepts current builds and ignores closed or stale PRs", () => {
    const { metadata, build, pr } = fixture();
    expect(validate(metadata, build, pr)).toBe(true);
    pr.head.sha = "c".repeat(40);
    expect(validate(metadata, build, pr)).toBe(false);
    for (const change of [
      () => {
        pr.state = "closed";
      },
      () => {
        pr.head.repo = null;
      },
      () => {
        pr.head.repo = { full_name: "attacker/fork" };
      },
      () => {
        pr.user.login = "dependabot[bot]";
      },
    ]) {
      change();
      expect(validate(metadata, build, pr)).toBe(false);
    }
  });
  it("rejects forged images, PR numbers, runs, attempts, heads and untrusted builds", () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => {
        f.metadata.image = "attacker/image:latest";
      },
      (f: ReturnType<typeof fixture>) => {
        f.metadata.image += "\nmalicious=value";
      },
      (f: ReturnType<typeof fixture>) => {
        f.metadata.image += "\n";
      },
      (f: ReturnType<typeof fixture>) => {
        f.metadata.prNumber = "../../bad";
      },
      (f: ReturnType<typeof fixture>) => {
        f.metadata.runId = "99";
      },
      (f: ReturnType<typeof fixture>) => {
        f.metadata.runAttempt = "2";
      },
      (f: ReturnType<typeof fixture>) => {
        f.metadata.headSha = "d".repeat(40);
      },
      (f: ReturnType<typeof fixture>) => {
        f.build.head_branch = "other-pr";
      },
      (f: ReturnType<typeof fixture>) => {
        f.build.event = "pull_request_target";
      },
      (f: ReturnType<typeof fixture>) => {
        f.build.conclusion = "failure";
      },
      (f: ReturnType<typeof fixture>) => {
        f.build.head_repository.full_name = "attacker/fork";
      },
      (f: ReturnType<typeof fixture>) => {
        f.build.actor.login = "dependabot[bot]";
      },
    ]) {
      const f = fixture();
      mutate(f);
      expect(() => validate(f.metadata, f.build, f.pr)).toThrow();
    }
  });
});
it("preserves newer config and existing secrets", async () => {
  const { metadata, build, pr } = fixture();
  expect(await update(root, metadata, build, pr)).toEqual(metadata);
  const config = join(root, "previews/pr-123/config.json");
  const newer = { ...metadata, runId: "101" };
  writeFileSync(config, JSON.stringify(newer));
  vi.mocked(ensureSecret).mockClear();
  expect(await update(root, metadata, build, pr)).toBeUndefined();
  expect(ensureSecret).not.toHaveBeenCalled();
  expect(JSON.parse(readFileSync(config, "utf8"))).toEqual(newer);
});
it("removes only closed previews and fails closed on API errors", async () => {
  for (const n of [123, 124]) mkdirSync(join(root, `previews/pr-${n}`));
  await removeClosed(root, async (n) => ({
    ...fixture().pr,
    state: n === "123" ? "closed" : "open",
  }));
  expect(existsSync(join(root, "previews/pr-123"))).toBe(false);
  await expect(
    removeClosed(root, async () => {
      throw new Error("API failed");
    }),
  ).rejects.toThrow();
  expect(existsSync(join(root, "previews/pr-124"))).toBe(true);
});
it("rejects symlinks and unexpected directories", async () => {
  for (const name of ["production", "pr-001"]) {
    const path = join(root, "previews", name);
    mkdirSync(path);
    await expect(
      removeClosed(root, async () => fixture().pr),
    ).rejects.toThrow();
    rmSync(path, { recursive: true });
  }
  symlinkSync(root, join(root, "previews/pr-123"), "dir");
  await expect(removeClosed(root, async () => fixture().pr)).rejects.toThrow();
});
it("does not recreate PRs closed during sealing", async () => {
  const { metadata, build, pr } = fixture();
  vi.mocked(api).mockResolvedValue(pr);
  vi.mocked(ensureSecret).mockImplementation(() => {
    pr.state = "closed";
  });
  await expect(
    update(root, metadata, build, pr, async () => pr),
  ).resolves.toBeUndefined();
  expect(existsSync(join(root, "previews/pr-123"))).toBe(false);
});
it("backfills successful CI runs on schedule", async () => {
  const { metadata, build, pr } = fixture();
  vi.mocked(pages).mockImplementation(async function* () {
    yield pr;
  });
  vi.mocked(api).mockResolvedValue({ workflow_runs: [build] });
  vi.mocked(imageArtifact).mockResolvedValue(metadata);
  expect(await candidates({})).toEqual([[metadata, build]]);
  expect(await candidates({ pull_request: pr })).toEqual([]);
});
it("can commit and push locally, with no extra commit on an unchanged run", async () => {
  const remote = join(root, "remote.git");
  output("git", ["init", "--bare", remote]);
  const git = (...args: string[]) => output("git", ["-C", root, ...args]);
  git("init", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("add", "templates");
  git("commit", "-m", "Initial");
  git("remote", "add", "origin", remote);
  git("push", "origin", "main");
  const { metadata, build, pr } = fixture();
  vi.mocked(api).mockImplementation(async (path) =>
    path.includes("/actions/runs/") ? build : pr,
  );
  vi.mocked(imageArtifact).mockResolvedValue(metadata);
  await reconcile(root, { workflow_run: { id: 100 } }, true);
  const first = git("rev-parse", "HEAD");
  await reconcile(root, { workflow_run: { id: 100 } }, true);
  expect(git("rev-parse", "HEAD")).toBe(first);
  expect(first).toBe(git("rev-parse", "origin/main"));
});
it("only deletes exact closed-PR image tags", async () => {
  const suffix = `-sha-${"f".repeat(40)}-100-1`;
  const images = [
    {
      imageTags: [
        `main${suffix}`,
        `pr-123${suffix}`,
        `pr-124${suffix}`,
        "sha-legacy",
        `pr-001${suffix}`,
      ],
    },
    {},
  ];
  expect(
    await closedTags(images, async (pr) => ({
      state: pr === "123" ? "closed" : "open",
    })),
  ).toEqual([{ imageTag: `pr-123${suffix}` }]);
});
