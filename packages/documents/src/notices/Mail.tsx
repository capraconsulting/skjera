/** @jsxRuntime automatic @jsxImportSource react */
import {
  Email,
  EmailRejected,
  retryTransient,
  sendsEmail,
} from "@skjera/email";
import { renderEmail } from "@skjera/email/react";
import { m } from "@skjera/i18n/messages";
import { absoluteAppUrl, appPaths } from "@skjera/paths";
import { Clock, Config, Cron, Effect, Layer, Option, Schema } from "effect";
import { ClusterCron, ClusterSchema, Entity } from "effect/cluster";
import { Rpc } from "effect/rpc";
import { SqlClient } from "effect/sql";
import type { ReactElement } from "react";
import { Attendance } from "../attendance/Attendance.ts";
import { organizerEmails, signupClosesAt } from "../events/ContentTypes.ts";
import { type RichText, SiteLocale } from "../Model.ts";
import { invitation, parseAddress } from "../site/Calendar.ts";
import { CancelRequested } from "./emails/CancelRequested.tsx";
import { EventCancelled } from "./emails/EventCancelled.tsx";
import { EventChanged } from "./emails/EventChanged.tsx";
import { formatAt, formatWhen } from "./emails/format.ts";
import { OrganizerEmail } from "./emails/OrganizerEmail.tsx";
import type { WrittenText } from "./emails/OrganizerText.tsx";
import { Reminder } from "./emails/Reminder.tsx";
import { SignedUp } from "./emails/SignedUp.tsx";
import { SignupCancelled } from "./emails/SignupCancelled.tsx";
import {
  Notifications,
  Recipient,
  type Signup,
  Times,
  tell,
} from "./Notifications.ts";

// Emails about an event to its attendees. Signing up, cancelling, an organizer
// taking someone off, and moving or deleting the event tell `Notifications`, in their transaction; on the server, that
// leaves a message for the event's mailer (a cluster entity, one per event,
// so its emails go out in order), kept in the database and deduplicated, so
// each email is sent once it's committed, and once only. Reminders are sent
// the same way, by a daily job.

const Send = Rpc.make("Send", {
  payload: {
    /** Each email once: what it's about, e.g. "signedUp/<signup>". */
    key: Schema.String,
    kind: Schema.Literals([
      "signedUp",
      "signupCancelled",
      "signupRemoved",
      "eventChanged",
      "eventCancelled",
      "reminder",
      "cancelRequested",
      "organizerEmail",
    ]),
    attendee: Recipient,
    /** When the event was, before it moved. */
    previously: Schema.optional(Times),
    /** Where it was, before it changed place: "" when it had none. */
    previousPlace: Schema.optional(Schema.String),
    /** When the link in an email to confirm cancelling stops working: milliseconds since the epoch. */
    expiresAt: Schema.optional(Schema.Number),
    /** For an organizer's email: the id of what the organizer wrote. */
    organizerEmail: Schema.optional(Schema.String),
  },
  primaryKey: ({ key }) => key,
}).annotate(ClusterSchema.Persisted, true);

/** An event's mailer: its id is the event's. */
export const EventMail = Entity.make("EventMail", [Send]);

/** Notices as emails, through the event's mailer. */
export const layerNotifications = Layer.effect(
  Notifications,
  Effect.gen(function* () {
    const mailer = yield* EventMail.client;
    const send = (event: string, payload: typeof Send.payloadSchema.Type) =>
      mailer(event).Send(payload, { discard: true }).pipe(Effect.orDie);
    return Notifications.of({
      signedUp: ({ event, attendee }) =>
        send(event, {
          key: `signedUp/${attendee.id}`,
          kind: "signedUp",
          attendee,
        }),
      signupCancelled: ({ event, attendee }) =>
        send(event, {
          key: `signupCancelled/${attendee.id}`,
          kind: "signupCancelled",
          attendee,
        }),
      signupRemoved: ({ event, attendee }) =>
        send(event, {
          key: `signupRemoved/${attendee.id}`,
          kind: "signupRemoved",
          attendee,
        }),
      cancelRequested: ({ event, attendee, expiresAt }) =>
        send(event, {
          key: `cancelRequested/${attendee.id}/${expiresAt}`,
          kind: "cancelRequested",
          attendee,
          expiresAt,
        }),
      eventChanged: ({ event, attendee, version, previously, previousPlace }) =>
        send(event, {
          key: `eventChanged/${version}/${attendee.id}`,
          kind: "eventChanged",
          attendee,
          ...(previously === undefined ? {} : { previously }),
          ...(previousPlace === undefined ? {} : { previousPlace }),
        }),
      eventCancelled: ({ event, attendee }) =>
        send(event, {
          key: `eventCancelled/${attendee.id}`,
          kind: "eventCancelled",
          attendee,
        }),
    });
  }),
);

/**
 * Where the site is, what it's called, who emails come from, and the
 * language they're in for those who didn't say (`SITE_LOCALE`).
 */
const SiteConfig = Config.all({
  url: Config.String("SITE_URL"),
  name: Config.String("SITE_NAME").pipe(Config.withDefault("Skjera")),
  from: Config.String("EMAIL_FROM"),
  locale: SiteLocale,
});

/** Emails to attendees are sent: a transport, and the settings the mailer needs. */
export const emailsSent = Config.all({
  transport: sendsEmail,
  site: Config.option(SiteConfig),
}).pipe(Config.map(({ transport, site }) => transport && Option.isSome(site)));

interface EventRow {
  readonly title: string;
  readonly starts_at: Date;
  readonly ends_at: Date;
  readonly signup_deadline: Date | null;
  readonly time_zone: string;
  /** Null: published before events had a place. */
  readonly place: string | null;
  /** What the event is; null: none. */
  readonly summary: string | null;
  readonly ask_dietary: boolean;
  /**
   * The subjects (strings) and texts (spans) the organiser wrote for the
   * emails, by key, e.g. `signedUpSubject`; a key is there only when
   * something is written.
   */
  readonly email_texts: Readonly<Record<string, string | RichText>>;
  readonly published_at: Date;
  readonly first_published_at: Date;
  /** The event's team: who organizes it. */
  readonly team: string;
  readonly deleted: boolean;
}

/**
 * Sends the event's emails, as its mailer gets them. Without `SITE_URL` and
 * `EMAIL_FROM`, with a warning, it drops them: they'd have no links, or
 * sender.
 */
export const layerMailer = Layer.unwrap(
  Effect.gen(function* () {
    const site = yield* Config.option(SiteConfig);
    if (Option.isSome(site)) return mailer(site.value);
    yield* Effect.logWarning(
      "SITE_URL or EMAIL_FROM not set: attendees aren't emailed",
    );
    return EventMail.toLayer(
      EventMail.of({
        Send: ({ payload }) =>
          Effect.logInfo("Email not sent (SITE_URL or EMAIL_FROM not set)", {
            kind: payload.kind,
          }),
      }),
    );
  }),
);

const mailer = (site: Config.Success<typeof SiteConfig>) =>
  EventMail.toLayer(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const email = yield* Email;
      const attendance = yield* Attendance;
      const address = yield* Entity.CurrentAddress;
      const eventId = address.entityId;
      const from = parseAddress(site.from);
      const host = new URL(site.url).host;

      return EventMail.of({
        Send: ({ payload }) =>
          Effect.gen(function* () {
            const [event] = yield* sql<EventRow>`
            SELECT e.title, e.starts_at, e.ends_at, e.signup_deadline, e.time_zone,
              e.place, e.summary, e.ask_dietary, e.email_texts, e.published_at,
              e.first_published_at, t.name AS team,
              e.deleted_at IS NOT NULL AS deleted
            FROM events e
              JOIN documents d ON d.id = e.id
              JOIN teams t ON t.id = d.team_id
            WHERE e.id = ${eventId}
          `.pipe(Effect.orDie);
            // Deleted meanwhile: nothing more to tell than that.
            if (
              event === undefined ||
              (event.deleted && payload.kind !== "eventCancelled")
            ) {
              return;
            }

            const url = absoluteAppUrl(site.url, appPaths.event(eventId));
            const { attendee } = payload;
            // In the language they signed up in.
            const locale = attendee.locale ?? site.locale;
            const when = formatWhen(
              locale,
              event.starts_at,
              event.ends_at,
              event.time_zone,
            );
            const calendar = (
              method: "REQUEST" | "CANCEL",
              cancelled = false,
            ) => ({
              method,
              content: invitation({
                method,
                event: {
                  id: eventId,
                  title: event.title,
                  startsAt: event.starts_at,
                  endsAt: event.ends_at,
                  url,
                  cancelled,
                  ...(event.place === null ? {} : { place: event.place }),
                  ...(event.summary === null
                    ? {}
                    : { description: event.summary }),
                  // Newer with each republish.
                  sequence: Math.floor(
                    (event.published_at.getTime() -
                      event.first_published_at.getTime()) /
                      1000,
                  ),
                },
                attendee,
                organizer: { name: event.team, email: from.email },
                site: { name: site.name, host },
              }),
            });

            // The organiser's own subject, followed by the event's title, and
            // text in place of the opening.
            const fieldsFor = (kind: string) =>
              organizerEmails.find((email) => email.kind === kind) as
                | { readonly subject: string; readonly text: string }
                | undefined;
            const subjectOf = (kind: string, standard: string) => {
              const fields = fieldsFor(kind);
              const written =
                fields === undefined
                  ? undefined
                  : event.email_texts[fields.subject];
              return typeof written === "string"
                ? `${written} ${event.title}`
                : standard;
            };
            const textOf = (
              kind: string,
            ): { readonly text: WrittenText } | Record<string, never> => {
              const fields = fieldsFor(kind);
              const written =
                fields === undefined
                  ? undefined
                  : event.email_texts[fields.text];
              return Array.isArray(written)
                ? {
                    text: {
                      spans: written,
                      site: site.url,
                      place: event.place,
                    },
                  }
                : {};
            };

            // What an organizer wrote, if the person is still signed up: else nothing is sent.
            const [written] =
              payload.kind === "organizerEmail"
                ? yield* sql<{
                    readonly subject: string;
                    readonly text: string;
                    readonly sent_by_name: string | null;
                    readonly sent_by_email: string | null;
                  }>`
                    SELECT o.subject, o.text, o.sent_by_name, o.sent_by_email
                    FROM organizer_emails o
                    WHERE o.id = ${payload.organizerEmail ?? null}
                      AND o.event_id = ${eventId}
                      AND EXISTS (
                        SELECT 1 FROM attendees a
                        WHERE a.id = ${attendee.id} AND a.event_id = ${eventId}
                      )
                  `.pipe(Effect.orDie)
                : [];

            const guestLink = attendee.guest
              ? {
                  guestLink: absoluteAppUrl(
                    site.url,
                    appPaths.guestEvent(
                      eventId,
                      attendee.id,
                      attendance.guestToken(attendee.id),
                    ),
                  ),
                }
              : {};
            const message = ((): {
              readonly subject: string;
              readonly body: ReactElement;
              readonly calendar?: ReturnType<typeof calendar>;
              readonly replyTo?: {
                readonly name: string;
                readonly address: string;
              };
            } | null => {
              switch (payload.kind) {
                case "organizerEmail": {
                  // Cancelled or taken off since it was queued, or the record is gone.
                  if (written === undefined) return null;
                  return {
                    subject: written.subject,
                    body: (
                      <OrganizerEmail
                        locale={locale}
                        siteName={site.name}
                        title={event.title}
                        text={written.text}
                        url={url}
                      />
                    ),
                    ...(written.sent_by_email === null
                      ? {}
                      : {
                          replyTo: {
                            name: written.sent_by_name ?? written.sent_by_email,
                            address: written.sent_by_email,
                          },
                        }),
                  };
                }
                case "signedUp":
                  return {
                    subject: subjectOf(
                      "signedUp",
                      m.email_signed_up_subject(
                        { title: event.title },
                        { locale },
                      ),
                    ),
                    body: (
                      <SignedUp
                        locale={locale}
                        siteName={site.name}
                        name={attendee.name}
                        title={event.title}
                        when={when}
                        url={url}
                        {...guestLink}
                        closes={formatAt(
                          locale,
                          signupClosesAt(
                            event.signup_deadline,
                            event.starts_at,
                          ),
                          event.time_zone,
                        )}
                        food={event.ask_dietary}
                        {...textOf("signedUp")}
                      />
                    ),
                    calendar: calendar("REQUEST"),
                  };
                case "signupCancelled":
                case "signupRemoved":
                  return {
                    subject: subjectOf(
                      "signupCancelled",
                      m.email_left_subject({ title: event.title }, { locale }),
                    ),
                    body: (
                      <SignupCancelled
                        locale={locale}
                        siteName={site.name}
                        name={attendee.name}
                        title={event.title}
                        when={when}
                        url={url}
                        removed={payload.kind === "signupRemoved"}
                        {...textOf("signupCancelled")}
                      />
                    ),
                    calendar: calendar("CANCEL"),
                  };
                case "cancelRequested":
                  return {
                    subject: m.email_cancel_requested_subject(
                      { title: event.title },
                      { locale },
                    ),
                    body: (
                      <CancelRequested
                        locale={locale}
                        siteName={site.name}
                        name={attendee.name}
                        title={event.title}
                        when={when}
                        url={absoluteAppUrl(
                          site.url,
                          appPaths.cancelEvent(
                            eventId,
                            attendance.cancelLinkToken(
                              eventId,
                              attendee.id,
                              payload.expiresAt ?? 0,
                            ),
                          ),
                        )}
                      />
                    ),
                  };
                case "eventChanged": {
                  const moved = payload.previously !== undefined;
                  const newPlace =
                    payload.previousPlace !== undefined && event.place !== null;
                  const subject =
                    moved && newPlace
                      ? m.email_moved_and_new_place_subject
                      : newPlace
                        ? m.email_new_place_subject
                        : m.email_moved_subject;
                  return {
                    subject: subjectOf(
                      "eventChanged",
                      subject({ title: event.title }, { locale }),
                    ),
                    body: (
                      <EventChanged
                        locale={locale}
                        siteName={site.name}
                        name={attendee.name}
                        title={event.title}
                        when={when}
                        {...(payload.previously === undefined
                          ? {}
                          : {
                              previously: formatWhen(
                                locale,
                                new Date(payload.previously.startsAt),
                                new Date(payload.previously.endsAt),
                                event.time_zone,
                              ),
                            })}
                        {...(newPlace && event.place !== null
                          ? {
                              place: event.place,
                              previousPlace: payload.previousPlace ?? "",
                            }
                          : {})}
                        url={url}
                        {...guestLink}
                        {...textOf("eventChanged")}
                      />
                    ),
                    calendar: calendar("REQUEST"),
                  };
                }
                case "eventCancelled":
                  return {
                    subject: subjectOf(
                      "eventCancelled",
                      m.email_cancelled_subject(
                        { title: event.title },
                        { locale },
                      ),
                    ),
                    body: (
                      <EventCancelled
                        locale={locale}
                        siteName={site.name}
                        name={attendee.name}
                        title={event.title}
                        when={when}
                        {...textOf("eventCancelled")}
                      />
                    ),
                    calendar: calendar("CANCEL", true),
                  };
                case "reminder":
                  // Already in their calendar: no invitation.
                  return {
                    subject: subjectOf(
                      "reminder",
                      m.email_reminder_subject(
                        { title: event.title },
                        { locale },
                      ),
                    ),
                    body: (
                      <Reminder
                        locale={locale}
                        siteName={site.name}
                        name={attendee.name}
                        title={event.title}
                        when={when}
                        url={url}
                        {...guestLink}
                        {...textOf("reminder")}
                      />
                    ),
                  };
              }
            })();
            if (message === null) {
              // Left since it was queued: not counted among those it went to.
              if (payload.kind === "organizerEmail") {
                yield* sql`
                  UPDATE organizer_emails SET recipients = recipients - 1
                  WHERE id = ${payload.organizerEmail ?? null}
                    AND event_id = ${eventId} AND recipients > 0
                `.pipe(Effect.orDie);
              }
              return;
            }
            const rendered = yield* renderEmail(message.body);

            yield* email
              .send({
                from: site.from,
                to: { name: attendee.name, address: attendee.email },
                subject: message.subject,
                html: rendered.html,
                text: rendered.text,
                ...(message.calendar === undefined
                  ? {}
                  : { calendar: message.calendar }),
                ...(message.replyTo === undefined
                  ? {}
                  : { replyTo: message.replyTo }),
              })
              .pipe(
                retryTransient({ times: 8 }),
                // An address the provider won't send to: nothing more to do.
                Effect.catchIf(
                  (error) => error instanceof EmailRejected,
                  (error) =>
                    Effect.logWarning("Email not sent", {
                      event: eventId,
                      kind: payload.kind,
                      reason: error.reason,
                    }),
                ),
                // Still failing: left for the next runner.
                Effect.orDie,
              );
          }),
      });
    }),
  );

/** Every day at 07:05 UTC; the zone is given, else `Cron` reads the process's. */
export const reminderSchedule = Cron.parseUnsafe("5 7 * * *", "UTC");

/** The calendar the "next day" is counted in. */
const reminderTimeZone = "Europe/Oslo";

/**
 * Reminds everyone signed up for events starting on the next calendar day
 * in Norway, through each event's mailer: once for each time the event
 * starts (so moving it to another day reminds them again).
 */
export const sendReminders = (now: Date) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const mailer = yield* EventMail.client;
    const due = yield* sql<
      Signup & { readonly event_id: string; readonly starts_at: Date }
    >`
      SELECT a.id, a.name, a.email, a.user_issuer IS NULL AS guest, a.locale,
        e.id AS event_id, e.starts_at
      FROM events e JOIN attendees a ON a.event_id = e.id
      WHERE e.send_reminders AND e.deleted_at IS NULL AND a.email IS NOT NULL
        AND e.starts_at >= ((${now}::timestamptz AT TIME ZONE ${reminderTimeZone})::date + 1)::timestamp
          AT TIME ZONE ${reminderTimeZone}
        AND e.starts_at < ((${now}::timestamptz AT TIME ZONE ${reminderTimeZone})::date + 2)::timestamp
          AT TIME ZONE ${reminderTimeZone}
    `;
    yield* Effect.forEach(
      due,
      ({ event_id, starts_at, ...signup }) =>
        tell([signup], (attendee) =>
          mailer(event_id)
            .Send(
              {
                key: `reminder/${starts_at.getTime()}/${attendee.id}`,
                kind: "reminder",
                attendee,
              },
              { discard: true },
            )
            .pipe(Effect.orDie),
        ),
      { discard: true },
    );
  }).pipe(Effect.orDie);

/** `sendReminders`, daily, in one instance. */
export const reminders = ClusterCron.make({
  // Kept: the run already queued is taken by the same entity.
  name: "event-reminders",
  cron: reminderSchedule,
  execute: Effect.flatMap(Clock.currentTimeMillis, (millis) =>
    sendReminders(new Date(millis)),
  ),
});
