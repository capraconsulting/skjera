import { assert, layer } from "@effect/vitest";
import { Identity } from "@skjera/oauth/api";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { Attendance } from "../../src/attendance/Attendance.ts";
import type { DocumentId } from "../../src/Model.ts";
import { OrganizerEmails } from "../../src/notices/OrganizerEmails.ts";
import { clusterSettled } from "../cluster.ts";
import {
  alice,
  emailsTo,
  outbox,
  publishedEvent,
  TestLayer,
} from "./helpers.ts";

// An organizer's email to everyone signed up, from the service call to the
// outbox: through the event's mailer on a cluster on the test database.

const OrganizerTestLayer = OrganizerEmails.layer.pipe(
  Layer.provideMerge(TestLayer),
);

const member = (name: string) =>
  new Identity({
    issuer: "https://idp.example",
    subject: `${name}-${crypto.randomUUID()}`,
    email: `${name}-${crypto.randomUUID()}@example.org`,
    name,
  });

const guestAddress = (name: string) =>
  `${name}-${crypto.randomUUID()}@example.org`;

/** The row of the signup that `address` made. */
const signupOf = (address: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ id: string }>`
      SELECT id FROM attendees WHERE email = ${address}
    `;
    return row?.id ?? "";
  }).pipe(Effect.orDie);

const recordsOf = (event: DocumentId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ n: number }>`
      SELECT count(*)::int AS n FROM organizer_emails WHERE event_id = ${event}
    `;
    return row?.n ?? 0;
  }).pipe(Effect.orDie);

// Real clock: these tests talk to a real database and a real cluster.
layer(OrganizerTestLayer, { excludeTestServices: true })(
  "Organizer emails",
  (it) => {
    it.effect(
      "refuses when nobody signed up has an email, and records nothing (AC-1)",
      () =>
        Effect.gen(function* () {
          const organizerEmails = yield* OrganizerEmails;
          const event = yield* publishedEvent();
          const sql = yield* SqlClient.SqlClient;
          // A member whose identity had no email.
          yield* sql`
            INSERT INTO attendees (event_id, name, user_issuer, user_subject)
            VALUES (${event}, 'No Email', 'https://idp.example', ${crypto.randomUUID()})
          `;

          const refused = yield* Effect.flip(
            organizerEmails.send(event, alice, {
              subject: "Nytt rom",
              text: "Vi er i rom 3.",
            }),
          );

          assert.strictEqual(refused._tag, "OrganizerEmailRejected");
          assert.strictEqual(
            refused._tag === "OrganizerEmailRejected" && refused.problem._tag,
            "NobodyToEmail",
          );
          assert.strictEqual(yield* recordsOf(event), 0);
        }),
    );

    it.effect(
      "sends each of those signed up one email, from the site, with the organizer as reply-to and the event's title and link after the text (AC-2)",
      () =>
        Effect.gen(function* () {
          const attendance = yield* Attendance;
          const organizerEmails = yield* OrganizerEmails;
          const event = yield* publishedEvent();
          const bob = member("bob");
          const gina = guestAddress("gina");
          yield* attendance.attend(event, bob);
          yield* attendance.attendAsGuest(event, {
            name: "Gina",
            email: gina,
          });
          yield* emailsTo(bob.email ?? "", 1);
          yield* emailsTo(gina, 1);

          const sent = yield* organizerEmails.send(event, alice, {
            subject: "Nytt rom",
            text: "Vi er i rom 3.\n\nTa med lader.",
          });
          assert.strictEqual(sent.recipients, 2);

          for (const address of [bob.email ?? "", gina]) {
            const received = yield* emailsTo(address, 2);
            // The signup's own email came first: this is the one after it.
            assert.lengthOf(received, 2);
            const message = received[1]?.message;
            assert.strictEqual(message?.subject, "Nytt rom");
            assert.strictEqual(message?.from, process.env.EMAIL_FROM);
            assert.deepStrictEqual(message?.replyTo, {
              name: "Alice",
              address: "alice@example.com",
            });
            assert.isUndefined(message?.calendar);
            const link = `${process.env.SITE_URL}/events/${event}`;
            for (const body of [message?.text ?? "", message?.html ?? ""]) {
              assert.include(body, "Vi er i rom 3.");
              assert.include(body, "Ta med lader.");
              assert.include(body, "Launch");
              assert.include(body, link);
              assert.isBelow(
                body.indexOf("Ta med lader."),
                body.lastIndexOf(link),
              );
            }
          }
        }),
    );

    it.effect(
      "refuses a subject or a text that is empty or only spaces, records nothing and sends nothing (AC-3)",
      () =>
        Effect.gen(function* () {
          const attendance = yield* Attendance;
          const organizerEmails = yield* OrganizerEmails;
          const event = yield* publishedEvent();
          const bob = member("bob");
          yield* attendance.attend(event, bob);
          yield* emailsTo(bob.email ?? "", 1);

          const noSubject = yield* Effect.flip(
            organizerEmails.send(event, alice, {
              subject: "   ",
              text: "Vi er i rom 3.",
            }),
          );
          const noText = yield* Effect.flip(
            organizerEmails.send(event, alice, {
              subject: "Nytt rom",
              text: "",
            }),
          );

          assert.deepStrictEqual(
            [noSubject, noText].map(
              (each) =>
                each._tag === "OrganizerEmailRejected" && each.problem._tag,
            ),
            ["EmailSubjectMissing", "EmailTextMissing"],
          );
          assert.strictEqual(yield* recordsOf(event), 0);
          yield* clusterSettled;
          assert.lengthOf(outbox.to(bob.email ?? ""), 1);
        }),
    );

    it.effect(
      "lists emails with the canonical sender name, newest first (AC-1, AC-2, AC-4)",
      () =>
        Effect.gen(function* () {
          const attendance = yield* Attendance;
          const organizerEmails = yield* OrganizerEmails;
          const event = yield* publishedEvent();
          const other = yield* publishedEvent();
          const bob = member("bob");
          yield* attendance.attend(event, bob);
          yield* attendance.attendAsGuest(event, {
            name: "Gina",
            email: guestAddress("gina"),
          });
          yield* emailsTo(bob.email ?? "", 1);
          assert.deepStrictEqual(yield* organizerEmails.sent(event), []);

          yield* organizerEmails.send(event, alice, {
            subject: "First",
            text: "One.",
          });
          yield* organizerEmails.send(
            event,
            new Identity({
              issuer: "https://idp.example",
              subject: "no-name",
              name: "  ",
              email: "  nameless@example.com  ",
            }),
            { subject: "Second", text: "Two." },
          );
          yield* organizerEmails.send(
            event,
            new Identity({
              issuer: "https://idp.example",
              subject: "subject-only",
            }),
            { subject: "Third", text: "Three." },
          );

          const listed = yield* organizerEmails.sent(event);
          assert.deepStrictEqual(
            listed.map(({ subject, sentBy, recipients }) => ({
              subject,
              sentBy,
              recipients,
            })),
            [
              {
                subject: "Third",
                sentBy: "subject-only",
                recipients: 2,
              },
              {
                subject: "Second",
                sentBy: "nameless@example.com",
                recipients: 2,
              },
              { subject: "First", sentBy: "Alice", recipients: 2 },
            ],
          );
          assert.isAtMost(
            Math.abs(Date.now() - (listed[0]?.sentAt.getTime() ?? 0)),
            60_000,
          );
          assert.deepStrictEqual(yield* organizerEmails.sent(other), []);
        }),
    );

    it.effect(
      "sends nothing to those who cancelled or were taken off, and counts only the rest (AC-5)",
      () =>
        Effect.gen(function* () {
          const attendance = yield* Attendance;
          const organizerEmails = yield* OrganizerEmails;
          const event = yield* publishedEvent();
          const bob = member("bob");
          const gina = guestAddress("gina");
          const hana = guestAddress("hana");
          yield* attendance.attend(event, bob);
          const ginaToken = yield* attendance.attendAsGuest(event, {
            name: "Gina",
            email: gina,
          });
          yield* attendance.attendAsGuest(event, { name: "Hana", email: hana });
          yield* emailsTo(bob.email ?? "", 1);
          yield* emailsTo(gina, 1);
          yield* emailsTo(hana, 1);
          yield* attendance.leaveAsGuest(event, ginaToken);
          yield* attendance.remove(yield* signupOf(hana));
          yield* emailsTo(gina, 2);
          yield* emailsTo(hana, 2);

          const sent = yield* organizerEmails.send(event, alice, {
            subject: "Nytt rom",
            text: "Vi er i rom 3.",
          });

          assert.strictEqual(sent.recipients, 1);
          yield* emailsTo(bob.email ?? "", 2);
          assert.lengthOf(outbox.to(gina), 2);
          assert.lengthOf(outbox.to(hana), 2);
        }),
    );

    it.effect(
      "sends nothing to a signup deleted after the email was queued (AC-5)",
      () =>
        Effect.gen(function* () {
          const attendance = yield* Attendance;
          const organizerEmails = yield* OrganizerEmails;
          const sql = yield* SqlClient.SqlClient;
          const event = yield* publishedEvent();
          const gina = guestAddress("gina");
          const bob = member("bob");
          // Gina first: the event's mailer takes her message before bob's.
          yield* attendance.attendAsGuest(event, { name: "Gina", email: gina });
          yield* attendance.attend(event, bob);
          yield* emailsTo(gina, 1);
          yield* emailsTo(bob.email ?? "", 1);
          const ginaSignup = yield* signupOf(gina);

          // Both commit together: the mailer finds no row for her.
          yield* Effect.gen(function* () {
            yield* organizerEmails.send(event, alice, {
              subject: "Nytt rom",
              text: "Vi er i rom 3.",
            });
            yield* sql`DELETE FROM attendees WHERE id = ${ginaSignup}`;
          }).pipe(sql.withTransaction, Effect.orDie);

          yield* emailsTo(bob.email ?? "", 2);
          assert.lengthOf(outbox.to(gina), 1);
          // Listed as sent to the one who got it.
          assert.strictEqual(
            (yield* organizerEmails.sent(event))[0]?.recipients,
            1,
          );
        }),
    );
  },
);
