import { NodeCrypto } from "@effect/platform-node";
import { assert, layer } from "@effect/vitest";
import { Email } from "@skjera/email";
import * as EmailTest from "@skjera/email/testing";
import { Identity } from "@skjera/oauth/api";
import { Effect, Layer, Schedule } from "effect";
import { SingleRunner } from "effect/cluster";
import { SqlClient } from "effect/sql";
import { Attendance } from "../src/Attendance.ts";
import { Documents } from "../src/Documents.ts";
import * as Mail from "../src/Mail.tsx";
import type { DocumentId } from "../src/Model.ts";
import { Notifications } from "../src/Notifications.ts";
import { Teams } from "../src/Teams.ts";
import { TestDatabase } from "./TestDatabase.ts";

// Signups' emails, from signing up to the outbox: through the event's
// mailer on a cluster on the test database. (SITE_URL, SITE_NAME,
// EMAIL_FROM and SIGNING_SECRET as in mise.toml.)

const outbox = EmailTest.make();

const cluster = SingleRunner.layer({
  shardingConfig: {
    entityMessagePollInterval: "50 millis",
    entityReplyPollInterval: "50 millis",
  },
}).pipe(Layer.provide(NodeCrypto.layer));

const TestLayer = Layer.mergeAll(
  Documents.layer,
  Teams.layer,
  Mail.layerMailer,
).pipe(
  Layer.provideMerge(Attendance.layer),
  Layer.provideMerge(Mail.layerNotifications),
  Layer.provideMerge(Layer.succeed(Email, outbox.email)),
  Layer.provideMerge(cluster),
  Layer.provideMerge(TestDatabase),
);

const alice = new Identity({
  issuer: "https://idp.example",
  subject: "alice",
  email: "alice@example.com",
  name: "Alice",
});

let teams = 0;
/** A published event, from 18:00 to 21:00 in Oslo, open to guests. */
const publishedEvent = (options: { readonly dietary?: boolean } = {}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const team = yield* (yield* Teams).create(`Mail ${++teams}`, alice);
    const id = yield* (yield* Documents).create("event", team.id, alice);
    yield* sql`
      INSERT INTO events (id, title, starts_at, ends_at, time_zone, body, is_public,
        allow_guests, ask_dietary, published_heads,
        published_by_issuer, published_by_subject)
      VALUES (${id}, 'Launch', '2036-10-15T18:00+02', '2036-10-15T21:00+02',
        'Europe/Oslo', '[]', true, true, ${options.dietary ?? false},
        '{}', 'test', 'test')
    `;
    return id as DocumentId;
  }).pipe(Effect.orDie);

/** The emails sent to `address`, once there are `count`. */
const emailsTo = (address: string, count: number) =>
  Effect.sync(() => outbox.to(address)).pipe(
    Effect.filterOrFail(
      (sent) => sent.length >= count,
      () => "not yet",
    ),
    Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 60 }),
    Effect.orDie,
  );

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Mail", (it) => {
  it.effect("tells a guest they're signed up, then that they're not", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const event = yield* publishedEvent({ dietary: true });
      const signup = crypto.randomUUID();
      const address = `gina-${signup}@example.org`;
      const token = yield* attendance.attendAsGuest(
        event,
        { name: "Gina", email: address },
        { id: signup, dietary: "None" },
      );

      const [signedUp] = yield* emailsTo(address, 1);
      const message = signedUp?.message;
      assert.strictEqual(message?.subject, "You're signed up: Launch");
      assert.deepStrictEqual(message?.to, { name: "Gina", address });
      assert.strictEqual(message?.from, process.env.EMAIL_FROM);
      // Their own link, to change or cancel from anywhere.
      assert.include(
        message?.text ?? "",
        `${process.env.SITE_URL}/events/${event}?guest=${signup}&token=${token}`,
      );
      // (Intl puts thin spaces around the dash.)
      assert.match(
        message?.text ?? "",
        /Wednesday, October 15, 2036, 6:00\s–\s9:00\sPM \(Central European Time\)/,
      );
      assert.include(message?.text ?? "", "Food is served");
      // The invitation, for their calendar.
      assert.strictEqual(message?.calendar?.method, "REQUEST");
      const invitation = message?.calendar?.content ?? "";
      assert.include(invitation, "METHOD:REQUEST");
      assert.include(
        invitation,
        `UID:${event}@${new URL(process.env.SITE_URL ?? "").host}`,
      );
      assert.include(invitation, "DTSTART:20361015T160000Z");
      assert.include(invitation, "DTEND:20361015T190000Z");
      assert.match(invitation, /ATTENDEE;[^\r\n]*CN="Gina"/);
      assert.include(invitation, "SUMMARY:Launch");

      yield* attendance.leaveAsGuest(event, token);
      const [, cancelled] = yield* emailsTo(address, 2);
      assert.strictEqual(
        cancelled?.message.subject,
        "Signup cancelled: Launch",
      );
      assert.strictEqual(cancelled?.message.calendar?.method, "CANCEL");
      assert.include(
        cancelled?.message.calendar?.content ?? "",
        "METHOD:CANCEL",
      );
    }),
  );

  it.effect("tells members once, however often they sign up", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const event = yield* publishedEvent();
      const member = new Identity({
        issuer: "https://idp.example",
        subject: `m-${crypto.randomUUID()}`,
        email: `member-${crypto.randomUUID()}@example.com`,
        name: "Morten",
      });
      yield* attendance.attend(event, member);
      yield* attendance.attend(event, member);
      const sent = yield* emailsTo(member.email ?? "", 1);
      yield* Effect.sleep("300 millis");
      assert.strictEqual(outbox.to(member.email ?? "").length, 1);
      // Members get the event's page, not a guest's link.
      assert.notInclude(sent[0]?.message.text ?? "", "?guest=");

      yield* attendance.leave(event, member);
      const [, cancelled] = yield* emailsTo(member.email ?? "", 2);
      assert.strictEqual(cancelled?.message.calendar?.method, "CANCEL");
    }),
  );

  it.effect("tells attendees the new time when the event moves", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const notifications = yield* Notifications;
      const event = yield* publishedEvent();
      // Republished a day later.
      yield* sql`
        UPDATE events SET starts_at = '2036-10-16T18:00+02',
          ends_at = '2036-10-16T21:00+02'
        WHERE id = ${event}
      `;
      const signup = crypto.randomUUID();
      const address = `gina-${signup}@example.org`;
      const notice = {
        event,
        attendee: { id: signup, name: "Gina", email: address, guest: true },
        version: "1",
        previously: {
          startsAt: "2036-10-15T16:00:00.000Z",
          endsAt: "2036-10-15T19:00:00.000Z",
        },
      };
      yield* notifications.eventChanged(notice);
      // Told once of each change, however often it's said.
      yield* notifications.eventChanged(notice);

      const [moved] = yield* emailsTo(address, 1);
      const message = moved?.message;
      assert.strictEqual(message?.subject, "New time: Launch");
      assert.match(message?.text ?? "", /It's now Thursday, October 16, 2036/);
      assert.match(message?.text ?? "", /It was Wednesday, October 15, 2036/);
      assert.include(message?.text ?? "", `?guest=${signup}&token=`);
      assert.strictEqual(message?.calendar?.method, "REQUEST");
      const invitation = message?.calendar?.content ?? "";
      assert.include(invitation, "DTSTART:20361016T160000Z");
      yield* Effect.sleep("300 millis");
      assert.strictEqual(outbox.to(address).length, 1);
    }),
  );

  it.effect("tells nothing of a signup that was refused", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const event = yield* publishedEvent({ dietary: true });
      const address = `refused-${crypto.randomUUID()}@example.org`;
      // Without what they can't eat, as the event asks.
      const refused = yield* Effect.flip(
        attendance.attendAsGuest(event, { name: "Rolf", email: address }),
      );
      assert.strictEqual(refused._tag, "SignupRejected");
      yield* Effect.sleep("300 millis");
      assert.deepStrictEqual(outbox.to(address), []);
    }),
  );
});
