import { describe, expect, it } from "vitest";
import { pageTitle } from "../src/pageTitle.ts";

describe("pageTitle", () => {
  it("names the site and its companies on the front page", () => {
    expect(pageTitle({ page: "front" }, "Skjer")).toBe("Skjer | Capra Liflig");
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
