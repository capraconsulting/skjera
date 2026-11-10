import { execFileSync } from "node:child_process";
import { expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));

it("waits for all integration services in the repository's Compose project", async () => {
  await import("../src/services.ts");
  expect(execFileSync).toHaveBeenCalledOnce();
  expect(execFileSync).toHaveBeenCalledWith(
    "docker",
    ["compose", "up", "--detach", "--wait", "postgres", "rustfs", "mailpit"],
    { cwd: new URL("../../..", import.meta.url), stdio: "inherit" },
  );
});
