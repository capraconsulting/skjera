import { describe, expect, it } from "vitest";
import { pageTitle } from "../src/pageTitle.ts";

describe("pageTitle", () => {
  it("uses the configured site description on the front page (AC-3)", () => {
    expect(pageTitle({ page: "front" }, "Skjer", "Events together")).toBe(
      "Events together",
    );
  });

  it("is the event's title on its page", () => {
    expect(pageTitle({ page: "event", title: "Fagdag" }, "Skjer")).toBe(
      "Fagdag",
    );
  });

  it("is the site's name for an event without a title", () => {
    expect(pageTitle({ page: "event", title: "  " }, "Skjer")).toBe("Skjer");
  });

  it("names the privacy page, then the site", () => {
    expect(
      pageTitle({ page: "privacy", heading: "Personvernerklæring" }, "Skjer"),
    ).toBe("Personvernerklæring | Skjer");
  });
});
