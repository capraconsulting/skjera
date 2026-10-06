import ical, {
  ICalAttendeeRole,
  ICalAttendeeStatus,
  ICalCalendarMethod,
} from "ical-generator";

// Calendar invitations (iCalendar, RFC 5545/5546) for an event's
// attendees, sent with emails: mail clients offer to put them in calendars,
// and update or remove them when the next one comes.

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
  /** Who sends it: the address emails come from. */
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
    // UTC: needs no time zone definitions; calendars show it in theirs.
    start: event.startsAt,
    end: event.endsAt,
    summary: event.title,
    description: event.url,
    url: event.url,
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

/** "Skjera <events@example.com>" as a name and an address. */
export const parseAddress = (from: string): Person => {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return match === null
    ? { name: from.trim(), email: from.trim() }
    : { name: match[1] || (match[2] ?? ""), email: match[2] ?? "" };
};
