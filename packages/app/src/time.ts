const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const units: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "just now", "5 minutes ago", "yesterday", … */
export const timeAgo = (date: Date, now = new Date()): string => {
  const seconds = (date.getTime() - now.getTime()) / 1000;
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return relative.format(Math.round(seconds / size), unit);
    }
  }
  return "just now";
};

/** The viewer's time zone: "Europe/Oslo". */
export const localTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

/** "Norway Time", to say what zone times are shown in. */
export const timeZoneName = (timeZone: string, at = new Date()): string =>
  new Intl.DateTimeFormat(undefined, { timeZone, timeZoneName: "shortGeneric" })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value ?? timeZone;

const dateTime = (timeZone: string) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });

/** " (Norway Time)" when the viewer is elsewhere, so times aren't misread. */
const zoneNote = (timeZone: string, at: Date) =>
  timeZone === localTimeZone() ? "" : ` (${timeZoneName(timeZone, at)})`;

/**
 * When an event is, in its own time zone: "Thursday, October 15, 2026,
 * 6:00 – 9:00 PM", or both days in full when it runs past midnight.
 */
export const formatEventTimes = (
  startsAt: Date,
  endsAt: Date,
  timeZone: string,
): string =>
  dateTime(timeZone).formatRange(startsAt, endsAt) +
  zoneNote(timeZone, startsAt);

/** "Thursday, October 15, 2026 at 6:00 PM", in the given zone. */
export const formatDateTime = (at: Date, timeZone: string): string =>
  dateTime(timeZone).format(at) + zoneNote(timeZone, at);

/** "15 Oct 2026", the day it is in the given zone. */
export const formatDateIn = (at: Date, timeZone: string): string =>
  at.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  });
