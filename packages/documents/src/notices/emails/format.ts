import type { Locale } from "../../Model.ts";

// Dates and times in emails, in the reader's language: in the event's time
// zone, which is named, as the reader may be anywhere.

const zoneName = (locale: Locale, timeZone: string, at: Date) =>
  new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "longGeneric" })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value ?? timeZone;

const dateTime = (locale: Locale, timeZone: string) =>
  new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });

/**
 * "Thursday, October 15, 2026, 6:00 – 9:00 PM (Central European Time)", or
 * "torsdag 15. oktober 2026, 18:00–21:00 (sentraleuropeisk tid)".
 */
export const formatWhen = (
  locale: Locale,
  startsAt: Date,
  endsAt: Date,
  timeZone: string,
) =>
  `${dateTime(locale, timeZone).formatRange(startsAt, endsAt)} (${zoneName(locale, timeZone, startsAt)})`;

/** "Tuesday, October 13, 2026 at 12:00 PM (Central European Time)" */
export const formatAt = (locale: Locale, at: Date, timeZone: string) =>
  `${dateTime(locale, timeZone).format(at)} (${zoneName(locale, timeZone, at)})`;
