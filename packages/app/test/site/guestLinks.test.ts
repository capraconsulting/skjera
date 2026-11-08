import { appPaths, appSearch } from "@skjera/paths";
import { describe, expect, it } from "vitest";

describe("guest link loaders", () => {
  it("reads the guest and token written by the guest-link builder (AC-1)", () => {
    const url = new URL(
      appPaths.guestEvent("event", "signup", "guest-token"),
      "https://site.test",
    );
    expect(appSearch.guestEvent(url)).toEqual({
      guest: "signup",
      token: "guest-token",
    });
  });

  it("reads the token written by the cancellation-link builder (AC-2)", () => {
    const url = new URL(
      appPaths.cancelEvent("event", "cancel-token"),
      "https://site.test",
    );
    expect(appSearch.token(url)).toBe("cancel-token");
  });
});
