import { m } from "@skjera/i18n/messages";
import { getLocale } from "@skjera/i18n/runtime";

// Dates and times in the interface's language (see i18n.ts), not the
// browser's.

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
  const relative = new Intl.RelativeTimeFormat(getLocale(), {
    numeric: "auto",
  });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return relative.format(Math.round(seconds / size), unit);
    }
  }
  return m.common_just_now();
};

/** The viewer's time zone: "Europe/Oslo". */
export const localTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

/** "Norway Time", to say what zone times are shown in. */
export const timeZoneName = (timeZone: string, at = new Date()): string =>
  new Intl.DateTimeFormat(getLocale(), {
    timeZone,
    timeZoneName: "shortGeneric",
  })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value ?? timeZone;

const dateTime = (timeZone: string) =>
  new Intl.DateTimeFormat(getLocale(), {
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
  at.toLocaleDateString(getLocale(), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  });

/** "15 November 2026", the day it is in the given zone. */
export const formatDayIn = (at: Date, timeZone: string): string =>
  at.toLocaleDateString(getLocale(), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  });

/** "18:00", or "6:00 PM", on the clock in the given zone. */
export const formatClockIn = (at: Date, timeZone: string): string =>
  at.toLocaleTimeString(getLocale(), {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });

/** Whether `a` and `b` are on the same day in the given zone. */
export const sameDayIn = (a: Date, b: Date, timeZone: string): boolean => {
  const day = (at: Date) => at.toLocaleDateString("en-CA", { timeZone });
  return day(a) === day(b);
};

/**
 * The day an event is, in its zone: "Thursday 15 October 2026", or
 * "15–16 October 2026" when it runs over more than one.
 */
export const formatDaysIn = (
  startsAt: Date,
  endsAt: Date,
  timeZone: string,
): string =>
  sameDayIn(startsAt, endsAt, timeZone)
    ? startsAt.toLocaleDateString(getLocale(), {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone,
      })
    : new Intl.DateTimeFormat(getLocale(), {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone,
      }).formatRange(startsAt, endsAt);

/** "6:00 – 9:00 PM", in its zone, saying which when the viewer is elsewhere. */
export const formatHoursIn = (
  startsAt: Date,
  endsAt: Date,
  timeZone: string,
): string =>
  new Intl.DateTimeFormat(getLocale(), {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).formatRange(startsAt, endsAt) + zoneNote(timeZone, startsAt);
