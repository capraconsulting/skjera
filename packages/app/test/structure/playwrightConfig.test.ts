import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@skjera/test", () => ({
  composeServices: { server: ["postgres", "rustfs"] },
  dexDiscoveryUrl: () =>
    "http://localhost:5557/dex/.well-known/openid-configuration",
  testServerOrigin: (_env: unknown, port: number) => `http://localhost:${port}`,
}));
vi.mock("../e2e/port.ts", () => ({ reservePort: async () => 8802 }));

describe("Playwright configuration", () => {
  afterEach(() => {
    delete process.env.SKJERA_E2E_PORT;
    vi.resetModules();
  });

  it("waits for Dex at the shared port (AC-5)", async () => {
    process.env.SKJERA_E2E_PORT = "8802";
    const config = (await import("../../playwright.config.ts")).default;
    const webServer = config.webServer as ReadonlyArray<{ url: string }>;
    expect(webServer[0]?.url).toBe(
      "http://localhost:5557/dex/.well-known/openid-configuration",
    );
  });
});
