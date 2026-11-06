import type { Identity } from "@skjera/oauth/api";
import { Context, Effect, Layer } from "effect";
import { SqlClient, SqlError } from "effect/sql";
import { EventNotFound, OrganizerEmailRejected } from "../api/errors.ts";
import { refused } from "../api/Problems.ts";
import type { SentEmail } from "../api/PublicApi.ts";
import type { DocumentId } from "../Model.ts";
import { EventMail } from "./Mail.tsx";
import { type Signup, tell } from "./Notifications.ts";

// What an organizer writes to everyone signed up to an event. The text is
// kept, and one message per person goes to the event's mailer (see Mail.tsx),
// in the same transaction: it sends them in the background, once each, to
// those still signed up.

/** Their name, else their email: how a person is named in a list. */
const nameOf = (user: Identity) =>
  [user.name, user.email]
    .map((value) => value?.trim())
    .find((value) => value !== undefined && value !== "");

/** What a person has no value for, as the column holds it. */
const orNull = (value: string | undefined) =>
  value === undefined || value.trim() === "" ? null : value.trim();

/** Emails organizers send to those signed up to an event. */
export class OrganizerEmails extends Context.Service<
  OrganizerEmails,
  {
    /**
     * Sends `email` to everyone signed up to a published event who has an email
     * address, as `sender` (the reply-to): kept and queued, not yet delivered.
     */
    readonly send: (
      event: DocumentId,
      sender: Identity,
      email: { readonly subject: string; readonly text: string },
    ) => Effect.Effect<SentEmail, EventNotFound | OrganizerEmailRejected>;
    /** The emails sent for an event, newest first. */
    readonly sent: (
      event: DocumentId,
    ) => Effect.Effect<ReadonlyArray<SentEmail>>;
  }
>()("@skjera/documents/OrganizerEmails") {
  static readonly layer = Layer.effect(
    OrganizerEmails,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const mailer = yield* EventMail.client;

      const send = Effect.fn("OrganizerEmails.send")(function* (
        event: DocumentId,
        sender: Identity,
        email: { readonly subject: string; readonly text: string },
      ) {
        const subject = email.subject.trim();
        if (subject === "") {
          return yield* new OrganizerEmailRejected(
            refused({ _tag: "EmailSubjectMissing" }),
          );
        }
        if (email.text.trim() === "") {
          return yield* new OrganizerEmailRejected(
            refused({ _tag: "EmailTextMissing" }),
          );
        }
        return yield* Effect.gen(function* () {
          const [published] = yield* sql<{ readonly id: DocumentId }>`
            SELECT id FROM events WHERE id = ${event} AND deleted_at IS NULL
          `;
          if (published === undefined) {
            return yield* new EventNotFound({ id: event });
          }
          const signups = yield* sql<Signup>`
            SELECT id, name, email, user_issuer IS NULL AS guest, locale
            FROM attendees
            WHERE event_id = ${published.id} AND email IS NOT NULL
            ORDER BY created_at, id
          `;
          if (signups.length === 0) {
            return yield* new OrganizerEmailRejected(
              refused({ _tag: "NobodyToEmail" }),
            );
          }
          const [record] = yield* sql<SentEmail>`
            INSERT INTO organizer_emails (event_id, subject, text, sent_by_name,
              sent_by_email, recipients)
            VALUES (${published.id}, ${subject}, ${email.text},
              ${orNull(sender.name)}, ${orNull(sender.email)}, ${signups.length})
            RETURNING id, subject, ${nameOf(sender) ?? null}::text AS "sentBy",
              sent_at AS "sentAt", recipients
          `;
          if (record === undefined) {
            return yield* Effect.die("INSERT returned no row");
          }
          yield* tell(signups, (attendee) =>
            mailer(published.id)
              .Send(
                {
                  key: `organizerEmail/${record.id}/${attendee.id}`,
                  kind: "organizerEmail",
                  attendee,
                  organizerEmail: record.id,
                },
                { discard: true },
              )
              .pipe(Effect.orDie),
          );
          return record;
        }).pipe(
          sql.withTransaction,
          Effect.catchIf(SqlError.isSqlError, Effect.die),
        );
      }, Effect.uninterruptible);

      const sent = Effect.fn("OrganizerEmails.sent")(function* (
        event: DocumentId,
      ) {
        return yield* sql<SentEmail>`
          SELECT id, subject, coalesce(nullif(btrim(sent_by_name), ''), sent_by_email) AS "sentBy",
            sent_at AS "sentAt", recipients
          FROM organizer_emails
          WHERE event_id = ${event}
          ORDER BY sent_at DESC, id DESC
        `.pipe(Effect.orDie);
      });

      return OrganizerEmails.of({ send, sent });
    }),
  );
}
