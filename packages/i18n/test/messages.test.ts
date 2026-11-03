import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { m } from "../src/paraglide/messages.js";
import { baseLocale, locales } from "../src/paraglide/runtime.js";

// Every message in every language, saying the same things: a missing one
// would fall back to English without a word.

type Messages = Record<string, unknown>;
const read = (locale: string): Messages => {
  const { $schema: _, ...messages } = JSON.parse(
    readFileSync(
      new URL(`../messages/${locale}.json`, import.meta.url),
      "utf8",
    ),
  ) as Messages;
  return messages;
};

/** The placeholders a message uses, e.g. ["count", "title"]. */
const placeholders = (message: unknown) =>
  [...new Set(JSON.stringify(message).match(/\{[a-zA-Z_]+\}/g) ?? [])].sort();

describe("messages", () => {
  const base = read(baseLocale);

  it("were all compiled", () => {
    expect(Object.keys(m).sort()).toEqual(Object.keys(base).sort());
  });

  for (const locale of locales.filter((each) => each !== baseLocale)) {
    it(`are all in ${locale}, with the same placeholders`, () => {
      const translated = read(locale);
      expect(Object.keys(translated).sort()).toEqual(Object.keys(base).sort());
      for (const [key, message] of Object.entries(base)) {
        expect(placeholders(translated[key]), key).toEqual(
          placeholders(message),
        );
      }
    });
  }

  // How long the policy says data is kept: 30 days, and no other period.
  const period =
    /\d+\s+(?:dager|dagar|days|uker|veker|weeks|måneder|månader|months|år|years)\b/g;
  for (const locale of locales) {
    it(`names only 30 days as a period in the privacy policy, in ${locale} (AC-4)`, () => {
      const messages = read(locale);
      for (const [key, message] of Object.entries(messages)) {
        if (!key.startsWith("privacy_")) continue;
        for (const [named] of String(message).matchAll(period)) {
          expect(`${key}: ${named}`).toMatch(/: 30 (dager|dagar|days)$/);
        }
      }
      expect(String(messages.privacy_keep)).toMatch(/\b30\b/);
    });
  }

  for (const locale of locales) {
    it(`names the image tool with the words it shows, in ${locale} (AC-2)`, () => {
      expect(
        m
          .editor_alt_text_tool({}, { locale })
          .startsWith(m.editor_alt_text({}, { locale })),
      ).toBe(true);
    });
  }
});
