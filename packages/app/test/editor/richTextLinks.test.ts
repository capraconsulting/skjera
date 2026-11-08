import { linkProtocols, safeLink } from "@skjera/documents/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { safeHref } from "../../src/editor/text/richText.ts";

describe("safeHref", () => {
  beforeEach(() => {
    // safeHref resolves a relative address against the page's own.
    vi.stubGlobal("window", {
      location: { href: "https://skjer.example/studio" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps web and email addresses (STU-07 AC-4)", () => {
    expect(safeHref("https://example.com/a?b=c")).toBe(
      "https://example.com/a?b=c",
    );
    expect(safeHref("http://example.com/")).toBe("http://example.com/");
    expect(safeHref("mailto:alice@example.com")).toBe(
      "mailto:alice@example.com",
    );
  });

  it("refuses an address that is not a web or email address (STU-07 AC-4)", () => {
    expect(safeHref("ftp://example.com")).toBeNull();
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,<p>hi</p>")).toBeNull();
    expect(safeHref("tel:+4790000000")).toBeNull();
  });

  it("uses the published page's protocol rule (AC-4)", () => {
    expect(linkProtocols).toEqual(["http:", "https:", "mailto:"]);
    for (const href of ["https://example.com", "mailto:a@example.com"])
      expect(safeHref(href)).toBe(safeLink(href, window.location.href));
    for (const href of ["ftp://example.com", "javascript:alert(1)"])
      expect(safeHref(href)).toBe(safeLink(href, window.location.href));
  });
});
