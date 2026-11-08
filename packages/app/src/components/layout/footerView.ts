import type { FooterText, SiteFooter } from "@skjera/documents/api";
import type { Locale } from "@skjera/i18n/runtime";

/** A piece of the line of text: words, or a link. */
export type LinePiece = { readonly text: string; readonly href?: string };

export type LogoView = {
  readonly label: string;
  readonly src: string;
  readonly darkSrc?: string;
  readonly href?: string;
};

export type GroupView = {
  readonly title?: string;
  readonly logos: ReadonlyArray<LogoView>;
};

export type LinkView = {
  readonly label: string;
  readonly href: string;
  readonly logo?: { readonly src: string; readonly darkSrc?: string };
};

export type FooterView = {
  readonly heading?: string;
  readonly groups: ReadonlyArray<GroupView>;
  readonly links: ReadonlyArray<LinkView>;
  readonly line: ReadonlyArray<LinePiece>;
  /**
   * With at least one group, the privacy link sits in the groups' row;
   * else beside the text.
   */
  readonly privacyInRow: boolean;
};

/** The text for the page's language, else the Bokmål one. */
export const footerText = (text: FooterText, locale: Locale): string =>
  typeof text === "string" ? text : (text[locale] ?? text.nb);

/** An email address, or a web address starting with http://, https:// or www. */
const address =
  /(?:https?:\/\/|www\.)[^\s<>]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

const count = (text: string, char: string) => text.split(char).length - 1;

/**
 * The address without punctuation that ends a sentence: a full stop, comma,
 * semicolon, colon, `!` or `?`, and a `)` that has no `(` before it in the
 * address.
 */
const trimAddress = (found: string) => {
  let end = found.length;
  while (end > 0) {
    const last = found[end - 1] as string;
    const kept = found.slice(0, end);
    if (".,;:!?".includes(last)) end--;
    else if (last === ")" && count(kept, ")") > count(kept, "(")) end--;
    else break;
  }
  return found.slice(0, end);
};

const linkTo = (found: string) => {
  if (found.includes("@") && !/^(?:https?:\/\/|www\.)/.test(found)) {
    return `mailto:${found}`;
  }
  return found.startsWith("www.") ? `https://${found}` : found;
};

/** The line with `{year}` as the year, and email and web addresses as links. */
export const footerLine = (
  text: string,
  year: number,
): ReadonlyArray<LinePiece> => {
  const line = text.replaceAll("{year}", String(year));
  const pieces: LinePiece[] = [];
  let from = 0;
  for (const match of line.matchAll(address)) {
    const found = trimAddress(match[0]);
    if (found === "") continue;
    if (match.index > from) {
      pieces.push({ text: line.slice(from, match.index) });
    }
    pieces.push({ text: found, href: linkTo(found) });
    from = match.index + found.length;
  }
  if (from < line.length) pieces.push({ text: line.slice(from) });
  return pieces;
};

/** Everything the footer shows, in that language and year. */
export const footerView = (
  footer: SiteFooter | undefined,
  locale: Locale,
  year: number,
): FooterView => {
  const pick = (text: FooterText) => footerText(text, locale);
  const groups: ReadonlyArray<GroupView> = (footer?.groups ?? []).map(
    (group) => ({
      ...(group.title === undefined ? {} : { title: pick(group.title) }),
      logos: group.logos.map((logo) => ({
        label: pick(logo.label),
        src: logo.src,
        ...(logo.darkSrc === undefined ? {} : { darkSrc: logo.darkSrc }),
        ...(logo.href === undefined ? {} : { href: logo.href }),
      })),
    }),
  );
  return {
    ...(footer?.heading === undefined ? {} : { heading: pick(footer.heading) }),
    groups,
    links: (footer?.links ?? []).map((link) => ({
      label: pick(link.label),
      href: link.href,
      ...(link.logo === undefined ? {} : { logo: link.logo }),
    })),
    line: footer?.text === undefined ? [] : footerLine(pick(footer.text), year),
    privacyInRow: groups.length > 0,
  };
};
