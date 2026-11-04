import { describe, expect, it } from "vitest";
import {
  loginFailedPath,
  loginReturnFrom,
  offersLogInAgain,
  readLoginFailure,
} from "../src/site/loginFailure.ts";

describe("readLoginFailure", () => {
  it("reads a kind and a return path (AC-2, AC-3)", () => {
    expect(readLoginFailure("denied", "/events/abc")).toEqual({
      kind: "denied",
      returnTo: "/events/abc",
    });
    expect(readLoginFailure("expired", "/account")).toEqual({
      kind: "expired",
      returnTo: "/account",
    });
  });

  it("reads a kind it does not know, or none, as a failed login (AC-3)", () => {
    expect(readLoginFailure("something else", "/account").kind).toBe("failed");
    expect(readLoginFailure(null, "/account").kind).toBe("failed");
    expect(readLoginFailure(undefined, "/account").kind).toBe("failed");
  });

  it("reads a return that is missing or not a path of the site as the front page (AC-2)", () => {
    expect(readLoginFailure("expired", null).returnTo).toBe("/");
    expect(readLoginFailure("expired", "").returnTo).toBe("/");
    expect(readLoginFailure("expired", "account").returnTo).toBe("/");
    expect(readLoginFailure("expired", "https://evil.example/").returnTo).toBe(
      "/",
    );
  });
});

describe("offersLogInAgain", () => {
  it("offers to log in again after an expired or failed login only (AC-2, AC-3)", () => {
    expect(offersLogInAgain("expired")).toBe(true);
    expect(offersLogInAgain("failed")).toBe(true);
    expect(offersLogInAgain("denied")).toBe(false);
  });
});

describe("loginFailedPath", () => {
  it("is an address the app reads back as the same failure (AC-2, AC-3)", () => {
    for (const kind of ["denied", "expired", "failed"] as const) {
      const failure = { kind, returnTo: "/events/abc?x=1;y=2,3&z=å#top" };
      const url = new URL(loginFailedPath(failure), "https://site.example");

      expect(url.pathname).toBe("/login-failed");
      expect(
        readLoginFailure(
          url.searchParams.get("kind"),
          url.searchParams.get("returnTo"),
        ),
      ).toEqual(failure);
    }
  });
});

describe("loginReturnFrom", () => {
  it("keeps the page's path and query (AC-1)", () => {
    expect(loginReturnFrom({ pathname: "/", search: "?tag=Social" })).toBe(
      "/?tag=Social",
    );
    expect(loginReturnFrom({ pathname: "/events/abc", search: "" })).toBe(
      "/events/abc",
    );
  });

  it("gives the front page from the failed-login page (AC-4)", () => {
    expect(
      loginReturnFrom({
        pathname: "/login-failed",
        search: "?kind=failed&returnTo=%2Faccount",
      }),
    ).toBe("/");
  });
});
