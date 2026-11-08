/** @jsxRuntime automatic @jsxImportSource react */
import { sendsEmail } from "@skjera/email";
import { Config, Effect, Layer, Schema } from "effect";
import { ClusterSchema, Entity } from "effect/cluster";
import { Rpc } from "effect/rpc";
import { optionalSetting, type RichText, SiteSettings } from "../Model.ts";
import { Notifications, Recipient, Times } from "./Notifications.ts";

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
      organizerEmail: ({ event, attendee, organizerEmail }) =>
        send(event, {
          key: `organizerEmail/${organizerEmail}/${attendee.id}`,
          kind: "organizerEmail",
          attendee,
          organizerEmail,
        }),
      reminder: ({ event, attendee, version }) =>
        send(event, {
          key: `reminder/${version}/${attendee.id}`,
          kind: "reminder",
          attendee,
        }),
    });
  }),
);

/**
 * Where the site is, what it's called, who emails come from, and the
 * language they're in for those who didn't say (`SITE_LOCALE`).
 */
/** Emails to attendees are sent: a transport, and the settings the mailer needs. */
export const emailsSent = Effect.gen(function* () {
  const transport = yield* sendsEmail;
  const { url } = yield* SiteSettings;
  const from = yield* optionalSetting("EMAIL_FROM", Config.String);
  return transport && url !== undefined && from !== undefined;
});

export interface EventRow {
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
    const site = yield* SiteSettings;
    const from = yield* optionalSetting("EMAIL_FROM", Config.String);
    if (site.url !== undefined && from !== undefined) {
      return mailer({ ...site, url: site.url, from });
    }
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

import { mailer } from "./EventEmails.tsx";

export { mailer } from "./EventEmails.tsx";
export { reminderSchedule, reminders, sendReminders } from "./Reminders.ts";
