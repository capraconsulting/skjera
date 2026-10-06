// Dates and times in emails: in the event's time zone, which is named, as
// the reader may be anywhere.

const zoneName = (timeZone: string, at: Date) =>
  new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "longGeneric" })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value ?? timeZone;

const dateTime = (timeZone: string) =>
  new Intl.DateTimeFormat("en", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });

/** "Thursday, October 15, 2026, 6:00 – 9:00 PM (Central European Time)" */
export const formatWhen = (startsAt: Date, endsAt: Date, timeZone: string) =>
  `${dateTime(timeZone).formatRange(startsAt, endsAt)} (${zoneName(timeZone, startsAt)})`;

/** "Tuesday, October 13, 2026 at 12:00 PM (Central European Time)" */
export const formatAt = (at: Date, timeZone: string) =>
  `${dateTime(timeZone).format(at)} (${zoneName(timeZone, at)})`;
