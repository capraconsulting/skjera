import {
  baseLocale,
  cookieName,
  getLocale,
  locales,
} from "@skjera/i18n/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { languages, loadSite } from "../../src/i18n.ts";

// The runtime counts as a server without `window`, so it reads the cookie
// and the site's language and writes no cookie of its own.
const page = { cookie: "", documentElement: { lang: "" }, title: "" };

beforeEach(() => {
  page.cookie = "";
  vi.stubGlobal("document", page);
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          name: "Skjera",
          locale: "nn",
          privacy: { operator: "Skjera" },
        }),
      ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the site's language", () => {
  it("has a picker name for every catalogue language (AC-2)", () => {
    expect(languages.map(({ locale }) => locale).sort()).toEqual(
      [...locales].sort(),
    );
  });

  it("is the language set in SITE_LOCALE for a visitor who has not picked one, and the visitor's pick wins (ACC-06 AC-6)", async () => {
    expect(getLocale()).toBe(baseLocale);
    await loadSite();
    expect(getLocale()).toBe("nn");
    expect(page.documentElement.lang).toBe("nn");

    page.cookie = `${cookieName}=nb`;
    // The runtime keeps the cookie it read until the next microtask.
    await Promise.resolve();
    expect(getLocale()).toBe("nb");
  });
});
