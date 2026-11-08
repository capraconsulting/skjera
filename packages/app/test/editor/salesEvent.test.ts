import { describe, expect, it } from "vitest";
import { salesEventOffered } from "../../src/editor/salesEvent.ts";

describe("salesEventOffered", () => {
  const open = { public: true, guests: true };

  it("is offered for a public event open to guests, on a site that sends to HubSpot (AC-1)", () => {
    expect(salesEventOffered({ salesEvents: true }, open)).toBe(true);
  });

  it("is not offered when the event is not public, or not open to guests (AC-1)", () => {
    expect(
      salesEventOffered({ salesEvents: true }, { public: false, guests: true }),
    ).toBe(false);
    expect(
      salesEventOffered({ salesEvents: true }, { public: true, guests: false }),
    ).toBe(false);
  });

  it("is not offered on a site without HUBSPOT_ACCESS_TOKEN (AC-11)", () => {
    expect(salesEventOffered({}, open)).toBe(false);
    expect(salesEventOffered({ salesEvents: false }, open)).toBe(false);
  });
});
