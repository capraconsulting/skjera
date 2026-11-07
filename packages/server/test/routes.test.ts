import { describe, expect, it } from "vitest";
import {
  serverRoutePrefixes,
  serverRoutePrefixesFor,
  serverRoutes,
} from "../src/routes.ts";

describe("server route prefixes", () => {
  it("derives the proxy prefixes from the server-owned routes (AC-5)", () => {
    expect(serverRoutePrefixes).toEqual(Object.values(serverRoutes));
    expect(serverRoutePrefixes).toContain("/auth");
    expect(serverRoutePrefixes).toContain("/api");
    expect(serverRoutePrefixes).toContain("/automerge");
  });

  it("adds a configured callback outside the auth prefix (AC-4, AC-5)", () => {
    expect(
      serverRoutePrefixesFor("http://localhost:5173/custom/callback"),
    ).toContain("/custom/callback");
    expect(
      serverRoutePrefixesFor("http://localhost:5173/auth/callback"),
    ).toEqual(serverRoutePrefixes);
  });
});
