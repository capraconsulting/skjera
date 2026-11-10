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
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("GITHUB_RUN_ID", "100");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("creates an exact-head transient deployment without merge or required contexts", async () => {
  vi.mocked(api).mockResolvedValue(deployment);
  await create("123", deployment.sha);
  expect(vi.mocked(api).mock.calls[0]?.[1]).toMatchObject({
    ref: deployment.sha,
    auto_merge: false,
    required_contexts: [],
    transient_environment: true,
    production_environment: false,
  });
  expect(vi.mocked(api).mock.calls[1]?.[1]).toMatchObject({
    state: "in_progress",
    environment_url: "https://pr-123.skjera.capraconsulting.no",
  });
});
it("reports success only for the desired image and healthy database", async () => {
  const { pr, metadata } = fixture();
  vi.mocked(api).mockImplementation(async (path, data) =>
    path.includes("/pulls/")
      ? pr
      : data && path.endsWith("/deployments")
        ? deployment
        : {},
  );
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("ok", { headers: { "X-Skjera-Image": metadata.image } }),
      ),
  );
  await wait("123", metadata.image, metadata.headSha);
  expect(vi.mocked(api).mock.calls.at(-1)?.[1]).toMatchObject({
    state: "success",
  });
});
it("reports readiness timeouts as failures", async () => {
  const { pr, metadata } = fixture();
  vi.mocked(api).mockImplementation(async (path) =>
    path.includes("/pulls/") ? pr : deployment,
  );
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("ok", { headers: { "X-Skjera-Image": "wrong-image" } }),
      ),
  );
  // Zero deadline exercises the failure status without sleeping.
  await expect(
    wait("123", metadata.image, metadata.headSha, 0),
  ).rejects.toThrow("did not become ready");
  expect(vi.mocked(api).mock.calls.at(-1)?.[1]).toMatchObject({
    state: "failure",
  });
});
it("ignores stale PR revisions before deployment creation", async () => {
  vi.mocked(api).mockResolvedValue(fixture().pr);
  await wait("123", fixture().metadata.image, "c".repeat(40));
  expect(api).toHaveBeenCalledTimes(1);
});
it("marks a PR closed during readiness inactive", async () => {
  const { pr, metadata } = fixture();
  let reads = 0;
  vi.mocked(api).mockImplementation(async (path) =>
    path.includes("/pulls/")
      ? { ...pr, state: ++reads === 1 ? "open" : "closed" }
      : deployment,
  );
  await wait("123", metadata.image, metadata.headSha);
  expect(vi.mocked(api).mock.calls.at(-1)?.[1]).toMatchObject({
    state: "inactive",
  });
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
    vi.mocked(api).mockImplementation(async (path, data) =>
      data
        ? {}
        : path.includes("/statuses")
          ? [{ state: previous }]
          : { ...fixture().pr, state: closed ? "closed" : "open" },
    );
    await retireClosed();
    expect(
      vi
        .mocked(api)
        .mock.calls.some(
          (call) =>
            (call[1] as { state?: string } | undefined)?.state === "inactive",
        ),
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
