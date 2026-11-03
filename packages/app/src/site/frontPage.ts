import type { EventRow } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { sameTag } from "../tags.ts";
import { formatClockIn, formatDayIn, sameDayIn } from "../time.ts";
import { audience } from "./audience.ts";

/** Events coming up or going on, soonest first; those over, latest first. */
export const upcomingAndPast = <
  E extends Pick<EventRow, "startsAt" | "endsAt">,
>(
  events: ReadonlyArray<E>,
  now: Date,
): {
  readonly upcoming: ReadonlyArray<E>;
  readonly past: ReadonlyArray<E>;
} => ({
  upcoming: events
    .filter((event) => event.endsAt > now)
    .toSorted((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
  past: events
    .filter((event) => event.endsAt <= now)
    .toSorted((a, b) => b.startsAt.getTime() - a.startsAt.getTime()),
});

/** How many events a list shows at first, and adds each time. */
export const pageSize = 6;

/** The first `count` items, and whether more are hidden. */
export const paged = <T>(
  items: ReadonlyArray<T>,
  count: number,
): { readonly shown: ReadonlyArray<T>; readonly more: boolean } => ({
  shown: items.slice(0, count),
  more: items.length > count,
});

/** The front page's lists: the filters narrow the upcoming events only. */
export const frontPageLists = <
  E extends Pick<EventRow, "startsAt" | "endsAt" | "tags" | "allowGuests">,
>(
  events: ReadonlyArray<E>,
  filters: {
    readonly tag: string | null;
    readonly allowGuests: boolean | null;
  },
  now: Date,
): {
  readonly upcoming: ReadonlyArray<E>;
  readonly past: ReadonlyArray<E>;
} => {
  const { tag, allowGuests } = filters;
  const { upcoming, past } = upcomingAndPast(events, now);
  return {
    upcoming: upcoming.filter(
      (event) =>
        (tag === null || event.tags.some((each) => sameTag(each, tag))) &&
        (allowGuests === null || event.allowGuests === allowGuests),
    ),
    past,
  };
};

/** What an upcoming event's row says at a glance. */
export const rowMarks = (
  event: Pick<
    EventRow,
    "startsAt" | "endsAt" | "timeZone" | "allowGuests" | "tags"
  >,
  now: Date,
): {
  readonly happeningNow: boolean;
  /** «Open to all» or «Internal only». */
  readonly audience: string;
  /** "#Workshop", … */
  readonly tags: ReadonlyArray<string>;
  /** «Today at 6:00 PM», or the day, in the event's zone. */
  readonly when: string;
} => ({
  happeningNow: event.startsAt <= now && now < event.endsAt,
  audience: audience(event).badge,
  tags: event.tags.map((tag) => `#${tag}`),
  when: sameDayIn(event.startsAt, now, event.timeZone)
    ? m.site_today_at({ time: formatClockIn(event.startsAt, event.timeZone) })
    : formatDayIn(event.startsAt, event.timeZone),
});
