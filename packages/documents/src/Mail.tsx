/** @jsxRuntime automatic @jsxImportSource react */
import { Email, EmailRejected, retryTransient } from "@skjera/email";
import { renderEmail } from "@skjera/email/react";
import { m } from "@skjera/i18n/messages";
import { Config, Cron, Effect, Layer, Option, Schema } from "effect";
import { ClusterCron, ClusterSchema, Entity } from "effect/cluster";
import { Rpc } from "effect/rpc";
import { SqlClient } from "effect/sql";
import type { ReactElement } from "react";
import { Attendance } from "./Attendance.ts";
import { invitation, parseAddress } from "./Calendar.ts";
import { EventCancelled } from "./emails/EventCancelled.tsx";
import { EventChanged } from "./emails/EventChanged.tsx";
import { formatAt, formatWhen } from "./emails/format.ts";
import { Reminder } from "./emails/Reminder.tsx";
import { SignedUp } from "./emails/SignedUp.tsx";
import { SignupCancelled } from "./emails/SignupCancelled.tsx";
import { SiteLocale } from "./Model.ts";
import {
  Notifications,
  Recipient,
  type Signup,
  Times,
  tell,
} from "./Notifications.ts";

// Emails about an event to its attendees. Signing up, cancelling, and
// moving or deleting the event tell `Notifications`, in their transaction; on the server, that
// leaves a message for the event's mailer (a cluster entity, one per event,
// so its emails go out in order), kept in the database and deduplicated, so
// each email is sent once it's committed, and once only. Reminders are sent
// the same way, by an hourly job.

const Send = Rpc.make("Send", {
  payload: {
    /** Each email once: what it's about, e.g. "signedUp/<signup>". */
    key: Schema.String,
    kind: Schema.Literals([
      "signedUp",
      "signupCancelled",
      "eventChanged",
      "eventCancelled",
      "reminder",
    ]),
    attendee: Recipient,
    /** When the event was, before it moved. */
    previously: Schema.optional(Times),
    /** Where it was, before it changed place: "" when it had none. */
    previousPlace: Schema.optional(Schema.String),
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
  readonly food_deadline: Date | null;
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
              e.place, e.summary, e.ask_dietary, e.food_deadline, e.published_at,
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

            const url = new URL(`/events/${eventId}`, site.url).href;
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

            const guestLink = attendee.guest
              ? {
                  guestLink: `${url}?guest=${attendee.id}&token=${attendance.guestToken(attendee.id)}`,
                }
              : {};
            const message = ((): {
              readonly subject: string;
              readonly body: ReactElement;
              readonly calendar?: ReturnType<typeof calendar>;
            } => {
              switch (payload.kind) {
                case "signedUp":
                  return {
                    subject: m.email_signed_up_subject(
                      { title: event.title },
                      { locale },
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
                          event.signup_deadline ?? event.starts_at,
                          event.time_zone,
                        )}
                        {...(event.ask_dietary
                          ? {
                              dietaryBy: formatAt(
                                locale,
                                event.food_deadline ??
                                  event.signup_deadline ??
                                  event.starts_at,
                                event.time_zone,
                              ),
                            }
                          : {})}
                      />
                    ),
                    calendar: calendar("REQUEST"),
                  };
                case "signupCancelled":
                  return {
                    subject: m.email_left_subject(
                      { title: event.title },
                      { locale },
                    ),
                    body: (
                      <SignupCancelled
                        locale={locale}
                        siteName={site.name}
                        name={attendee.name}
                        title={event.title}
                        when={when}
                        url={url}
                      />
                    ),
                    calendar: calendar("CANCEL"),
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
                    subject: subject({ title: event.title }, { locale }),
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
                      />
                    ),
                    calendar: calendar("REQUEST"),
                  };
                }
                case "eventCancelled":
                  return {
                    subject: m.email_cancelled_subject(
                      { title: event.title },
                      { locale },
                    ),
                    body: (
                      <EventCancelled
                        locale={locale}
                        siteName={site.name}
                        name={attendee.name}
                        title={event.title}
                        when={when}
                      />
                    ),
                    calendar: calendar("CANCEL", true),
                  };
                case "reminder":
                  // Already in their calendar: no invitation.
                  return {
                    subject: m.email_reminder_subject(
                      { title: event.title },
                      { locale },
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
                      />
                    ),
                  };
              }
            })();
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

/**
 * Reminds attendees of events starting within a day, hourly, through each
 * event's mailer: once for each time the event starts (so moving it reminds
 * them again), and not those who signed up within the day, as their
 * signup's email just told them.
 */
export const sendReminders = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const mailer = yield* EventMail.client;
  const due = yield* sql<
    Signup & { readonly event_id: string; readonly starts_at: Date }
  >`
      SELECT a.id, a.name, a.email, a.user_issuer IS NULL AS guest, a.locale,
        e.id AS event_id, e.starts_at
      FROM events e JOIN attendees a ON a.event_id = e.id
      WHERE e.send_reminders AND e.deleted_at IS NULL AND a.email IS NOT NULL
        AND e.starts_at > now() AND e.starts_at <= now() + interval '1 day'
        AND a.created_at < e.starts_at - interval '1 day'
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

/** `sendReminders`, hourly, in one instance. */
export const reminders = ClusterCron.make({
  name: "event-reminders",
  cron: Cron.parseUnsafe("0 * * * *"),
  execute: sendReminders,
});
