import { afterEach, expect, it, vi } from "vitest";
import { api, pages } from "../github.ts";
import { run } from "../process.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("posts deployment data as JSON without putting the token in the URL", async () => {
  vi.stubEnv("GH_TOKEN", "test-private-token");
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ id: 42 })));
  vi.stubGlobal("fetch", fetch);
  expect(await api("repos/example/app/deployments", { ref: "head" })).toEqual({
    id: 42,
  });
  expect(fetch.mock.calls[0]?.[0]).toBe(
    "https://api.github.com/repos/example/app/deployments",
  );
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({
    method: "POST",
    body: JSON.stringify({ ref: "head" }),
    headers: { Authorization: "Bearer test-private-token" },
  });
});
it("paginates without truncating a full GitHub page", async () => {
  vi.stubEnv("GH_TOKEN", "test-token");
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: Array.from({ length: 100 }, (_, id) => ({ id })),
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [{ id: 100 }] })),
    );
  vi.stubGlobal("fetch", fetch);
  const result = [];
  for await (const item of pages<{ id: number }>(
    "repos/example/app/artifacts?name=test",
    "items",
  ))
    result.push(item);
  expect(result).toHaveLength(101);
  expect(fetch.mock.calls[1]?.[0]).toContain("&per_page=100&page=2");
});
it("does not leak a failed subprocess's secret stdin or stderr", () => {
  const secret = "private-test-value";
  expect(() =>
    run(
      process.execPath,
      [
        "-e",
        "process.stdin.on('data', d => { console.error(d.toString()); process.exit(1); })",
      ],
      secret,
    ),
  ).toThrow(/failed \(exit 1\)/);
  try {
    run(process.execPath, ["-e", "process.exit(1)"], secret);
  } catch (error) {
    expect(String(error)).not.toContain(secret);
  }
});
