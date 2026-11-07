import { serverRoutePrefixesFor } from "@skjera/server/routes";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backendProxy } from "../vite.config.ts";

describe("development proxy", () => {
  afterEach(() => {
    delete process.env.OAUTH_REDIRECT_URI;
    vi.resetModules();
  });

  it("uses every server-owned prefix (AC-5)", () => {
    expect(Object.keys(backendProxy)).toEqual(
      serverRoutePrefixesFor(process.env.OAUTH_REDIRECT_URI),
    );
  });

  it("proxies the configured OAuth callback path (AC-4, AC-5)", async () => {
    process.env.OAUTH_REDIRECT_URI = "http://localhost:5173/custom/callback";
    vi.resetModules();
    const configured = await import("../vite.config.ts");
    expect(Object.keys(configured.backendProxy)).toContain("/custom/callback");
  });
});
