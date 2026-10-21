import type { EventRow } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { formatClockIn, formatDayIn, sameDayIn } from "../time.ts";

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

/** What an upcoming event's row says at a glance. */
export const rowMarks = (
  event: Pick<
    EventRow,
    "startsAt" | "endsAt" | "timeZone" | "isPublic" | "tags"
  >,
  now: Date,
): {
  readonly happeningNow: boolean;
  /** «Open to all» or «Members only». */
  readonly audience: string;
  /** "#Workshop", … */
  readonly tags: ReadonlyArray<string>;
  /** «Today at 6:00 PM», or the day, in the event's zone. */
  readonly when: string;
} => ({
  happeningNow: event.startsAt <= now && now < event.endsAt,
  audience: event.isPublic ? m.site_open_to_all() : m.common_members_only(),
  tags: event.tags.map((tag) => `#${tag}`),
  when: sameDayIn(event.startsAt, now, event.timeZone)
    ? m.site_today_at({ time: formatClockIn(event.startsAt, event.timeZone) })
    : formatDayIn(event.startsAt, event.timeZone),
});
