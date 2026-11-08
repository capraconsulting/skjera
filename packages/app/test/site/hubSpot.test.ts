import { describe, expect, it } from "vitest";
import { sharesWithHubSpot } from "../../src/site/hubSpot.ts";

describe("sharesWithHubSpot", () => {
  it("names HubSpot when the site loads its script, or sends sign-ups to sales events", () => {
    expect(sharesWithHubSpot({ hubSpot: "12345" })).toBe(true);
    expect(sharesWithHubSpot({ salesEvents: true })).toBe(true);
    expect(sharesWithHubSpot({ hubSpot: "12345", salesEvents: true })).toBe(
      true,
    );
  });

  it("does not name HubSpot with neither", () => {
    expect(sharesWithHubSpot({})).toBe(false);
    expect(sharesWithHubSpot({ salesEvents: false })).toBe(false);
    expect(sharesWithHubSpot({ hubSpot: "" })).toBe(false);
  });
});
