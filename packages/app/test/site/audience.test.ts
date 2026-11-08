import { m } from "@skjera/i18n/messages";
import { baseLocale, overwriteGetLocale } from "@skjera/i18n/runtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { audience } from "../../src/site/audience.ts";

const nb = { locale: "nb" } as const;

// Bokmål, where the row's badge and the event page's line use different words.
beforeAll(() => {
  overwriteGetLocale(() => "nb");
});

afterAll(() => {
  overwriteGetLocale(() => baseLocale);
});

describe("audience", () => {
  it("says an event guests can sign up for is open to all (AC-1)", () => {
    const words = audience({ allowGuests: true });
    expect(words.badge).toBe(m.site_badge_open_to_all({}, nb));
    expect(words.page).toBe(m.site_open_to_all({}, nb));
  });

  it("says an event guests can't sign up for is internal only (AC-2)", () => {
    const words = audience({ allowGuests: false });
    expect(words.badge).toBe(m.site_badge_internal_only({}, nb));
    expect(words.page).toBe(m.site_internal_only({}, nb));
  });
});
