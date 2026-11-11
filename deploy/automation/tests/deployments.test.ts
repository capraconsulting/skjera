import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { create, type Deployment, retireClosed } from "../deployments.ts";
import { api, pages } from "../github.ts";
import { wait } from "../wait.ts";
import { fixture } from "./fixtures.ts";

vi.mock("../github.ts", async (original) => ({
  ...(await original<typeof import("../github.ts")>()),
  api: vi.fn(),
  pages: vi.fn(),
}));
const deployment: Deployment = {
  id: 42,
  environment: "pr-123",
  sha: "b".repeat(40),
};
const url = "https://pr-123.skjera.capraconsulting.no";
type Status = { state: string; environment_url?: string };
let existing: Deployment[];
let statuses: Status[];
let pr: ReturnType<typeof fixture>["pr"];
const posts = () =>
  vi.mocked(api).mock.calls.filter(([, data]) => data !== undefined);
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("GITHUB_RUN_ID", "100");
  existing = [];
  statuses = [];
  pr = fixture().pr;
  vi.mocked(api).mockImplementation(async (path, data) => {
    if (path.includes("/pulls/")) return structuredClone(pr);
    if (path.includes("/deployments?")) return existing;
    if (path.includes("/statuses?")) return statuses.slice(0, 1);
    if (path.endsWith("/deployments") && data) {
      existing = [deployment];
      return deployment;
    }
    if (path.endsWith("/statuses") && data) {
      statuses.unshift(data as Status);
      return {};
    }
    throw new Error(`Unexpected API call: ${path}`);
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("creates an exact-head transient deployment without merge or required contexts", async () => {
  await create("123", deployment.sha);
  expect(posts()[0]?.[1]).toMatchObject({
    ref: deployment.sha,
    auto_merge: false,
    required_contexts: [],
    transient_environment: true,
    production_environment: false,
  });
  expect(posts()[1]?.[1]).toMatchObject({
    state: "in_progress",
    environment_url: url,
  });
});
it("reuses the same deployment record across repeated reconciliation and retry runs", async () => {
  expect(await create("123", deployment.sha)).toEqual(deployment);
  expect(await create("123", deployment.sha)).toEqual(deployment);
  expect(await create("123", deployment.sha)).toEqual(deployment);
  expect(
    posts().filter(([path]) => path.endsWith("/deployments")),
  ).toHaveLength(1);
  expect(vi.mocked(api).mock.calls[0]?.[0]).toContain(
    `environment=pr-123&sha=${deployment.sha}`,
  );
});
it("creates a new record for a new PR head", async () => {
  // The API's SHA filter excludes deployments for the previous head.
  await create("123", "c".repeat(40));
  expect(posts()[0]?.[1]).toMatchObject({ ref: "c".repeat(40) });
});
it("hourly checks verify the image without creating deployments or repeating success statuses", async () => {
  existing = [deployment];
  statuses = [{ state: "success", environment_url: url }];
  const { metadata } = fixture();
  const fetch = vi
    .fn()
    .mockImplementation(
      async () =>
        new Response("ok", { headers: { "X-Skjera-Image": metadata.image } }),
    );
  vi.stubGlobal("fetch", fetch);
  await wait("123", metadata.image, metadata.headSha);
  await wait("123", metadata.image, metadata.headSha);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(posts()).toEqual([]);
});
it("reports success only for the desired image and healthy database", async () => {
  const { metadata } = fixture();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("ok", { headers: { "X-Skjera-Image": metadata.image } }),
      ),
  );
  await wait("123", metadata.image, metadata.headSha);
  expect(posts().at(-1)?.[1]).toMatchObject({ state: "success" });
});
it("retries a failed readiness check using its original deployment record", async () => {
  existing = [deployment];
  statuses = [{ state: "failure", environment_url: url }];
  const { metadata } = fixture();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("ok", { headers: { "X-Skjera-Image": metadata.image } }),
      ),
  );
  await wait("123", metadata.image, metadata.headSha);
  expect(posts()).toHaveLength(1);
  expect(posts()[0]).toEqual([
    expect.stringContaining("/42/statuses"),
    expect.objectContaining({ state: "success" }),
  ]);
});
it("reports readiness timeouts as failures, even when a previous run succeeded", async () => {
  existing = [deployment];
  statuses = [{ state: "success", environment_url: url }];
  const { metadata } = fixture();
  await expect(
    wait("123", metadata.image, metadata.headSha, 0),
  ).rejects.toThrow("did not become ready");
  expect(posts().at(-1)?.[1]).toMatchObject({ state: "failure" });
});
it("ignores stale PR revisions before deployment creation", async () => {
  await wait("123", fixture().metadata.image, "c".repeat(40));
  expect(api).toHaveBeenCalledTimes(1);
});
it("marks a PR closed during readiness inactive", async () => {
  const { metadata } = fixture();
  // The first lookup sees open; the next sees it closed during provisioning.
  vi.mocked(api).mockResolvedValueOnce(pr);
  pr = { ...pr, state: "closed" };
  await wait("123", metadata.image, metadata.headSha);
  expect(posts().at(-1)?.[1]).toMatchObject({ state: "inactive" });
});
it.each([
  [false, "b".repeat(40), "success", false],
  [true, "b".repeat(40), "success", true],
  [false, "c".repeat(40), "in_progress", true],
  [true, "b".repeat(40), "inactive", false],
])(
  "retires closed/superseded links idempotently (%s %s %s)",
  async (closed, sha, previous, expected) => {
    vi.mocked(pages).mockImplementation(async function* () {
      yield { ...deployment, sha };
    });
    pr = { ...pr, state: closed ? "closed" : "open" };
    statuses = [{ state: previous, environment_url: url }];
    await retireClosed();
    expect(
      posts().some(([, data]) => (data as Status).state === "inactive"),
    ).toBe(expected);
  },
);
it("fails closed if PR lookup fails", async () => {
  vi.mocked(pages).mockImplementation(async function* () {
    yield deployment;
  });
  vi.mocked(api).mockRejectedValue(new Error("GitHub unavailable"));
  await expect(retireClosed()).rejects.toThrow();
  expect(api).toHaveBeenCalledTimes(1);
});
