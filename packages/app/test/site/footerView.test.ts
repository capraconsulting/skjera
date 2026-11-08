import type { SiteFooter } from "@skjera/documents/api";
import { describe, expect, it } from "vitest";
import {
  footerLine,
  footerText,
  footerView,
} from "../../src/components/layout/footerView.ts";

const heading = { nb: "Vi er en del av Capra-gruppen", en: "Part of Capra" };

describe("footerText", () => {
  it("shows a plain string in every language (AC-6)", () => {
    for (const locale of ["nb", "nn", "en"] as const) {
      expect(footerText("Hello", locale)).toBe("Hello");
    }
  });

  it("shows the text for the page's language, else the Bokmål one (AC-6)", () => {
    const text = { nb: "Bokmål", en: "English" };
    expect(footerText(text, "en")).toBe("English");
    expect(footerText(text, "nb")).toBe("Bokmål");
    expect(footerText(text, "nn")).toBe("Bokmål");
  });
});

describe("footerLine", () => {
  it("replaces {year} with the year (AC-5)", () => {
    expect(footerLine("{year} © Capra, {year}", 2026)).toEqual([
      { text: "2026 © Capra, 2026" },
    ]);
  });

  it("makes email and web addresses into links, leaving the rest as text (AC-5)", () => {
    expect(
      footerLine(
        "{year} © Capra | post@capraconsulting.no | see www.capraconsulting.no.",
        2026,
      ),
    ).toEqual([
      { text: "2026 © Capra | " },
      {
        text: "post@capraconsulting.no",
        href: "mailto:post@capraconsulting.no",
      },
      { text: " | see " },
      {
        text: "www.capraconsulting.no",
        href: "https://www.capraconsulting.no",
      },
      { text: "." },
    ]);
  });

  it("links an address starting with http:// or https:// to itself (AC-5)", () => {
    expect(footerLine("https://example.com/a", 2026)).toEqual([
      { text: "https://example.com/a", href: "https://example.com/a" },
    ]);
    expect(footerLine("http://example.com", 2026)).toEqual([
      { text: "http://example.com", href: "http://example.com" },
    ]);
  });

  it("leaves punctuation after an address as text (AC-5)", () => {
    expect(footerLine("(see https://example.com/a, or b)", 2026)).toEqual([
      { text: "(see " },
      { text: "https://example.com/a", href: "https://example.com/a" },
      { text: ", or b)" },
    ]);
  });

  it("keeps a closing parenthesis that belongs to the address (AC-5)", () => {
    expect(
      footerLine("https://en.wikipedia.org/wiki/Oslo_(city)", 2026),
    ).toEqual([
      {
        text: "https://en.wikipedia.org/wiki/Oslo_(city)",
        href: "https://en.wikipedia.org/wiki/Oslo_(city)",
      },
    ]);
    expect(footerLine("(https://example.com/a)", 2026)).toEqual([
      { text: "(" },
      { text: "https://example.com/a", href: "https://example.com/a" },
      { text: ")" },
    ]);
  });

  it("leaves a bare domain as text (AC-5)", () => {
    expect(footerLine("capraconsulting.no", 2026)).toEqual([
      { text: "capraconsulting.no" },
    ]);
  });

  it("gives text with no year and no address as one piece (AC-5)", () => {
    expect(footerLine("Torggata 2-4, 0180 Oslo", 2026)).toEqual([
      { text: "Torggata 2-4, 0180 Oslo" },
    ]);
  });
});

describe("footerView", () => {
  const groups: SiteFooter["groups"] = [
    {
      title: { nb: "Sertifiseringer", en: "Certifications" },
      logos: [
        { label: "A", src: "/a.webp", darkSrc: "/a-dark.webp" },
        { label: "B", src: "/b.webp" },
      ],
    },
    {
      logos: [
        {
          label: { nb: "Capra-logo", en: "Capra logo" },
          src: "/c.webp",
          href: "https://www.capraconsulting.no/",
        },
      ],
    },
  ];

  it("gives the heading in the page's language, and none without one (AC-1, AC-6)", () => {
    expect(footerView({ heading }, "nb", 2026).heading).toBe(
      "Vi er en del av Capra-gruppen",
    );
    expect(footerView({ heading }, "en", 2026).heading).toBe("Part of Capra");
    expect(footerView({}, "nb", 2026).heading).toBeUndefined();
    expect(footerView(undefined, "nb", 2026).heading).toBeUndefined();
  });

  it("gives the groups in order, each with its title and logos (AC-2)", () => {
    const view = footerView({ groups }, "en", 2026);
    expect(view.groups).toEqual([
      {
        title: "Certifications",
        logos: [
          { label: "A", src: "/a.webp", darkSrc: "/a-dark.webp" },
          { label: "B", src: "/b.webp" },
        ],
      },
      {
        logos: [
          {
            label: "Capra logo",
            src: "/c.webp",
            href: "https://www.capraconsulting.no/",
          },
        ],
      },
    ]);
    expect(footerView({}, "en", 2026).groups).toEqual([]);
  });

  it("gives a logo's link only when it has one (AC-3)", () => {
    const [first, second] = footerView({ groups }, "nb", 2026).groups;
    expect(first?.logos[0]).not.toHaveProperty("href");
    expect(second?.logos[0]?.href).toBe("https://www.capraconsulting.no/");
  });

  it("puts the privacy link in the row only when there are groups (AC-7)", () => {
    expect(footerView({ groups }, "nb", 2026).privacyInRow).toBe(true);
    expect(footerView({ groups: [] }, "nb", 2026).privacyInRow).toBe(false);
    expect(footerView({ heading }, "nb", 2026).privacyInRow).toBe(false);
    expect(footerView(undefined, "nb", 2026).privacyInRow).toBe(false);
  });

  it("keeps today's form: links with their logos, the text as a line (AC-7)", () => {
    const view = footerView(
      {
        text: "Skjera · privacy@skjera.localhost",
        links: [
          {
            label: "Example Ltd",
            href: "https://example.com",
            logo: { src: "/l.svg", darkSrc: "/l-dark.svg" },
          },
        ],
      },
      "nb",
      2026,
    );
    expect(view.heading).toBeUndefined();
    expect(view.groups).toEqual([]);
    expect(view.privacyInRow).toBe(false);
    expect(view.links).toEqual([
      {
        label: "Example Ltd",
        href: "https://example.com",
        logo: { src: "/l.svg", darkSrc: "/l-dark.svg" },
      },
    ]);
    expect(view.line).toEqual([
      { text: "Skjera · " },
      {
        text: "privacy@skjera.localhost",
        href: "mailto:privacy@skjera.localhost",
      },
    ]);
  });

  it("gives an empty line without text, and the year in the text (AC-5)", () => {
    expect(footerView({}, "nb", 2026).line).toEqual([]);
    expect(
      footerView({ text: { nb: "{year} © Capra" } }, "en", 2027).line,
    ).toEqual([{ text: "2027 © Capra" }]);
  });
});
