import type {
  AdSource,
  Answer,
  AttendeeDetails,
  AttendeeRow,
} from "@skjera/documents/api";

export const attendeeDetails = (
  name: string,
  more: {
    readonly email?: string | null;
    readonly phone?: string | null;
    readonly company?: string | null;
    readonly source?: AdSource | null;
    readonly consent?: boolean;
    readonly answers?: ReadonlyArray<Answer>;
  } = {},
): AttendeeDetails => ({
  name,
  email:
    "email" in more
      ? (more.email ?? null)
      : `${name.toLowerCase()}@example.com`,
  phone: more.phone ?? null,
  company: more.company ?? null,
  source: more.source ?? null,
  consent: more.consent ?? false,
  answers: more.answers ?? [],
  guest: false,
});

export const attendee = (
  name: string,
  answers: ReadonlyArray<Answer> = [],
  more: {
    readonly online?: boolean;
    readonly phone?: string;
    readonly company?: string;
    readonly source?: AdSource;
    readonly consent?: boolean;
  } = {},
): AttendeeRow => ({
  id: name,
  eventId: "33333333-3333-4333-8333-333333333333" as AttendeeRow["eventId"],
  signedUpAt: new Date("2026-10-20T08:15:00.000Z"),
  changedAt: new Date("2026-10-20T08:15:00.000Z"),
  mine: false,
  online: more.online ?? false,
  details: attendeeDetails(name, { ...more, answers }),
});
