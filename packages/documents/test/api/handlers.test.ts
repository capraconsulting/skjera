import { describe, expect, it } from "vitest";
import * as PublicApi from "../../src/api/PublicApi.ts";
import * as Documents from "../../src/index.ts";

describe("documents API handlers", () => {
  it("exports the complete API and handler layer (AC-1, AC-4)", () => {
    const exports = Documents as Record<string, unknown>;

    expect(exports.Api).toBeDefined();
    expect(exports.ApiHandlers).toBeDefined();
    expect(exports.siteSettings).toBeDefined();
    expect(exports.loginFailurePage).toBeDefined();
  });

  it("declares a limit for every public write endpoint (AC-2)", () => {
    const writes = Object.values(PublicApi.EventsApi.endpoints)
      .filter((endpoint) => endpoint.method !== "GET")
      .map((endpoint) => endpoint.identifier)
      .sort();
    const limits = PublicApi.publicWriteLimits;

    expect(Object.keys(limits).sort()).toEqual(writes);

    expect(limits).toEqual({
      attend: "guest",
      leave: "member",
      leaveAsGuest: "guest",
      change: "member",
      changeAsGuest: "guest",
      requestCancel: "guest",
      confirmCancel: "guest",
    });
  });
});
