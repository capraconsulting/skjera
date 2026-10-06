/** @jsxRuntime automatic @jsxImportSource react */
import { Email, EmailRejected, retryTransient } from "@skjera/email";
import { renderEmail } from "@skjera/email/react";
import { Config, Effect, Layer, Schema } from "effect";
import { ClusterSchema, Entity } from "effect/cluster";
import { Rpc } from "effect/rpc";
import { SqlClient } from "effect/sql";
import { Attendance } from "./Attendance.ts";
import { invitation, parseAddress } from "./Calendar.ts";
import { formatAt, formatWhen } from "./emails/format.ts";
import { SignedUp } from "./emails/SignedUp.tsx";
import { SignupCancelled } from "./emails/SignupCancelled.tsx";
import {
  type Kind,
  type Notice,
  Notifications,
  Recipient,
} from "./Notifications.ts";

// Emails about an event to its attendees. Signing up and cancelling tell
// `Notifications`, in their transaction; on the server, that leaves a
// message for the event's mailer (a cluster entity, one per event, so its
// emails go out in order), kept in the database and deduplicated, so each
// email is sent once it's committed, and once only.

const Send = Rpc.make("Send", {
  payload: {
    /** Each email once: what it's about, e.g. "signedUp/<signup>". */
    key: Schema.String,
    kind: Schema.Literals(["signedUp", "signupCancelled"]),
    attendee: Recipient,
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
    const send = (kind: Kind) => (notice: Notice) =>
      mailer(notice.event)
        .Send(
          {
            key: `${kind}/${notice.attendee.id}`,
            kind,
            attendee: notice.attendee,
          },
          { discard: true },
        )
        .pipe(Effect.orDie);
    return {
      signedUp: send("signedUp"),
      signupCancelled: send("signupCancelled"),
    };
  }),
);

/** Where the site is, what it's called, and who emails come from. */
const SiteConfig = Config.all({
  url: Config.String("SITE_URL"),
  name: Config.String("SITE_NAME").pipe(Config.withDefault("Skjera")),
  from: Config.String("EMAIL_FROM"),
});

interface EventRow {
  readonly title: string;
  readonly starts_at: Date;
  readonly ends_at: Date;
  readonly signup_deadline: Date | null;
  readonly time_zone: string;
  readonly ask_dietary: boolean;
  readonly food_deadline: Date | null;
  readonly published_at: Date;
  readonly first_published_at: Date;
}

/** Sends the event's emails, as its mailer gets them. */
export const layerMailer = Layer.unwrap(
  Effect.map(SiteConfig, (site) => mailer(site)),
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
            SELECT title, starts_at, ends_at, signup_deadline, time_zone,
              ask_dietary, food_deadline, published_at, first_published_at
            FROM events WHERE id = ${eventId}
          `.pipe(Effect.orDie);
            // Deleted (or unpublished) meanwhile: nothing to tell.
            if (event === undefined) return;

            const url = new URL(`/events/${eventId}`, site.url).href;
            const when = formatWhen(
              event.starts_at,
              event.ends_at,
              event.time_zone,
            );
            const { attendee } = payload;
            const calendar = (method: "REQUEST" | "CANCEL") => ({
              method,
              content: invitation({
                method,
                event: {
                  id: eventId,
                  title: event.title,
                  startsAt: event.starts_at,
                  endsAt: event.ends_at,
                  url,
                  // Newer with each republish.
                  sequence: Math.floor(
                    (event.published_at.getTime() -
                      event.first_published_at.getTime()) /
                      1000,
                  ),
                },
                attendee,
                organizer: from,
                site: { name: site.name, host },
              }),
            });

            const message =
              payload.kind === "signedUp"
                ? {
                    subject: `You're signed up: ${event.title}`,
                    rendered: yield* renderEmail(
                      <SignedUp
                        siteName={site.name}
                        name={attendee.name}
                        title={event.title}
                        when={when}
                        url={url}
                        {...(attendee.guest
                          ? {
                              guestLink: `${url}?guest=${attendee.id}&token=${attendance.guestToken(attendee.id)}`,
                            }
                          : {})}
                        closes={formatAt(
                          event.signup_deadline ?? event.starts_at,
                          event.time_zone,
                        )}
                        {...(event.ask_dietary
                          ? {
                              dietaryBy: formatAt(
                                event.food_deadline ??
                                  event.signup_deadline ??
                                  event.starts_at,
                                event.time_zone,
                              ),
                            }
                          : {})}
                      />,
                    ),
                    calendar: calendar("REQUEST"),
                  }
                : {
                    subject: `Signup cancelled: ${event.title}`,
                    rendered: yield* renderEmail(
                      <SignupCancelled
                        siteName={site.name}
                        name={attendee.name}
                        title={event.title}
                        when={when}
                        url={url}
                      />,
                    ),
                    calendar: calendar("CANCEL"),
                  };

            yield* email
              .send({
                from: site.from,
                to: { name: attendee.name, address: attendee.email },
                subject: message.subject,
                html: message.rendered.html,
                text: message.rendered.text,
                calendar: message.calendar,
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
