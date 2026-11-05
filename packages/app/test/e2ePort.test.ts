import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listening, reservePort, tryLock, unlock } from "../e2e/port.ts";

const dir = () => mkdtempSync(join(tmpdir(), "e2e-port-"));
const free = async () => false;
// A pid no process has: above the highest pid macOS and Linux hand out.
const gone = 99_999_999;

describe("the browser tests' port", () => {
  it("is the first port when nothing holds it", async () => {
    expect(
      await reservePort({ dir: dir(), ports: [8806, 8805], inUse: free }),
    ).toBe(8806);
  });

  it("skips a port another live run holds", async () => {
    const d = dir();
    expect(tryLock(d, 8806, process.ppid)).toBe(true);
    expect(
      await reservePort({ dir: d, ports: [8806, 8805], inUse: free }),
    ).toBe(8805);
  });

  it("takes a port whose run is gone", async () => {
    const d = dir();
    writeFileSync(join(d, "skjera-e2e-8806.lock"), String(gone));
    expect(
      await reservePort({ dir: d, ports: [8806, 8805], inUse: free }),
    ).toBe(8806);
  });

  it("skips a port something listens on, and leaves no lock on it", async () => {
    const d = dir();
    const port = await reservePort({
      dir: d,
      ports: [8806, 8805],
      inUse: async (p) => p === 8806,
    });
    expect(port).toBe(8805);
    expect(tryLock(d, 8806, gone)).toBe(true);
  });

  it("says so when every port is taken", async () => {
    const d = dir();
    tryLock(d, 8806, process.ppid);
    await expect(
      reservePort({ dir: d, ports: [8806], inUse: free }),
    ).rejects.toThrow(/8806/);
  });

  it("is free again once unlocked", () => {
    const d = dir();
    expect(tryLock(d, 8806, process.ppid)).toBe(true);
    unlock(d, 8806);
    expect(tryLock(d, 8806, process.ppid)).toBe(true);
  });

  it("sees a server listening on a port", async () => {
    const server = createServer().listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const { port } = server.address() as { port: number };
    expect(await listening(port)).toBe(true);
    await new Promise((r) => server.close(r));
    expect(await listening(port)).toBe(false);
  });
});
