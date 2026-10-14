import { m } from "@skjera/i18n/messages";
import ical, {
  ICalAttendeeRole,
  ICalAttendeeStatus,
  ICalCalendarMethod,
  ICalEventStatus,
  ICalEventTransparency,
} from "ical-generator";
import type { Locale } from "../Model.ts";

// Calendar invitations (iCalendar, RFC 5545/5546) for an event's
// attendees, sent with emails: mail clients offer to put them in calendars,
// and update or remove them when the next one comes. And the calendar of
// coming events to subscribe to.

export interface InvitationEvent {
  readonly id: string;
  readonly title: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly url: string;
  /**
   * Goes up with each version sent, so calendars take the newest: e.g.
   * from when it was published.
   */
  readonly sequence: number;
  /** It won't happen: for everyone, not just this attendee. */
  readonly cancelled?: boolean;
  /** Where it is, as written. Missing: not known (published before). */
  readonly place?: string;
  /** What the event is: its summary. Missing: none. */
  readonly description?: string;
}

export interface Person {
  readonly name: string;
  readonly email: string;
}

/**
 * An invitation for `attendee`: "REQUEST" to put the event in their
 * calendar (or update it there), "CANCEL" to take it out.
 */
export const invitation = (options: {
  readonly method: "REQUEST" | "CANCEL";
  readonly event: InvitationEvent;
  readonly attendee: Person;
  /** Who organizes the event, by name, with the address emails come from. */
  readonly organizer: Person;
  /** The site's name and host, to name the calendar and make ids unique. */
  readonly site: { readonly name: string; readonly host: string };
}): string => {
  const { event, attendee, organizer, site } = options;
  const calendar = ical({
    name: site.name,
    prodId: { company: site.name, product: "Skjera", language: "EN" },
    method:
      options.method === "REQUEST"
        ? ICalCalendarMethod.REQUEST
        : ICalCalendarMethod.CANCEL,
  });
  calendar.createEvent({
    // The same for every version, so calendars update the one they have.
    id: `${event.id}@${site.host}`,
    sequence: event.sequence,
    ...(event.cancelled ? { status: ICalEventStatus.CANCELLED } : {}),
    // UTC: needs no time zone definitions; calendars show it in theirs.
    start: event.startsAt,
    end: event.endsAt,
    summary: event.title,
    // What it is, then where to sign up or cancel.
    description:
      event.description === undefined
        ? event.url
        : `${event.description}\n\n${event.url}`,
    url: event.url,
    ...(event.place === undefined ? {} : { location: event.place }),
    organizer: { name: organizer.name, email: organizer.email },
    attendees: [
      {
        name: attendee.name,
        email: attendee.email,
        role: ICalAttendeeRole.REQ,
        status: ICalAttendeeStatus.ACCEPTED,
        // No reply: it's answered on the site, not to the sender.
        rsvp: false,
      },
    ],
  });
  return calendar.toString();
};

/** An event as a calendar feed gives it. */
export interface FeedEvent {
  readonly id: string;
  readonly title: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** The event's page: where to sign up or cancel. */
  readonly url: string;
  /** Where it is, as written. Missing: not known (published before). */
  readonly place?: string;
  /** What the event is: its summary. Missing: none. */
  readonly summary?: string;
}

/**
 * A calendar of `events` to subscribe to, named «Skjer»: published
 * rather than sent to anyone, and each event marked as not taking up the
 * subscriber's time. Its words are in the site's language.
 */
export const feed = (options: {
  readonly events: ReadonlyArray<FeedEvent>;
  readonly site: { readonly host: string; readonly locale: Locale };
}): string => {
  const { events, site } = options;
  const calendar = ical({
    name: "Skjer",
    prodId: { company: site.host, product: "Skjera", language: "EN" },
    method: ICalCalendarMethod.PUBLISH,
  });
  for (const event of events) {
    const signup = m.calendar_signup_or_cancel(
      { url: event.url },
      { locale: site.locale },
    );
    calendar.createEvent({
      // As in invitations: the same event, wherever a calendar got it.
      id: `${event.id}@${site.host}`,
      start: event.startsAt,
      end: event.endsAt,
      summary: event.title,
      // What it is, then where to sign up or cancel.
      description:
        event.summary === undefined ? signup : `${event.summary}\n\n${signup}`,
      url: event.url,
      ...(event.place === undefined ? {} : { location: event.place }),
      transparency: ICalEventTransparency.TRANSPARENT,
    });
  }
  return calendar.toString();
};

/** "Skjera <events@example.com>" as a name and an address. */
export const parseAddress = (from: string): Person => {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return match === null
    ? { name: from.trim(), email: from.trim() }
    : { name: match[1] || (match[2] ?? ""), email: match[2] ?? "" };
};
