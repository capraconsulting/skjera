import { describe, expect, it } from "vitest";
import {
  appPaths,
  appPatterns,
  appQuery,
  appSearch,
  callbackPath,
} from "../src/index.ts";

describe("shared app paths", () => {
  it("builds encoded event, guest, cancellation and preview addresses (AC-1, AC-2)", () => {
    expect(appPatterns.event).toBe("/events/:id");
    expect(appPaths.event("a/b")).toBe("/events/a%2Fb");
    expect(appPaths.guestEvent("a/b", "guest&1", "token=2")).toBe(
      "/events/a%2Fb?guest=guest%261&token=token%3D2",
    );
    expect(appPaths.cancelEvent("event", "token&1")).toBe(
      "/events/event/cancel?token=token%261",
    );
    expect(appPaths.preview("event", "a,b")).toBe(
      "/events/event/preview?version=a%2Cb",
    );
    expect(
      appSearch.guestEvent(
        new URL(
          appPaths.guestEvent("event", "guest&1", "token=2"),
          "https://site.test",
        ),
      ),
    ).toEqual({ guest: "guest&1", token: "token=2" });
    expect(
      appSearch.token(
        new URL(appPaths.cancelEvent("event", "token&1"), "https://site.test"),
      ),
    ).toBe("token&1");
  });

  it("owns shared query names, fixed routes and configured callbacks (AC-4)", () => {
    expect(appQuery).toEqual({
      guest: "guest",
      token: "token",
      version: "version",
      kind: "kind",
      returnTo: "returnTo",
      tag: "tag",
    });
    expect(appPaths.login).toBe("/auth/login");
    expect(appPaths.logout).toBe("/auth/logout");
    expect(appPaths.loginFailed).toBe("/login-failed");
    expect(callbackPath("https://example.test/custom/callback")).toBe(
      "/custom/callback",
    );
  });

  it("builds cancellation links from the router pattern (AC-3)", () => {
    const original = appPatterns.cancelEvent;
    Object.assign(appPatterns, { cancelEvent: "/events/:id/withdraw" });
    try {
      expect(appPaths.cancelEvent("event", "token")).toBe(
        "/events/event/withdraw?token=token",
      );
    } finally {
      Object.assign(appPatterns, { cancelEvent: original });
    }
  });
});
