import { NodeCrypto } from "@effect/platform-node";
import { assert, layer } from "@effect/vitest";
import { Email } from "@skjera/email";
import * as EmailTest from "@skjera/email/testing";
import { Identity } from "@skjera/oauth/api";
import { Effect, Layer, Schedule } from "effect";
import { SingleRunner } from "effect/cluster";
import { SqlClient } from "effect/sql";
import { Announcements } from "../src/Announcements.ts";
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
  Layer.provideMerge(Announcements.layerTest),
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
/**
 * A published event open to guests: from 18:00 to 21:00 in Oslo on the 15th
 * of October 2036, or for three hours from `startsAt`.
 */
const publishedEventOf = (
  options: {
    readonly dietary?: boolean;
    readonly startsAt?: Date;
    readonly reminders?: boolean;
    /** Where it is; null: published before events had a place. */
    readonly place?: string | null;
    /** What the event is; missing: none. */
    readonly summary?: string;
  } = {},
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const team = yield* (yield* Teams).create(`Mail ${++teams}`, alice);
    const id = yield* (yield* Documents).create("event", team.id, alice);
    const startsAt = options.startsAt ?? new Date("2036-10-15T18:00+02:00");
    const endsAt = new Date(startsAt.getTime() + 3 * 60 * 60 * 1000);
    yield* sql`
      INSERT INTO events (id, title, starts_at, ends_at, time_zone, body, is_public,
        allow_guests, ask_dietary, send_reminders, place, summary, published_heads,
        published_by_issuer, published_by_subject)
      VALUES (${id}, 'Launch', ${startsAt}, ${endsAt},
        'Europe/Oslo', '[]', true, true, ${options.dietary ?? false},
        ${options.reminders ?? true}, ${options.place === undefined ? "Kantina" : options.place},
        ${options.summary ?? null}, '{}', 'test', 'test')
    `;
    return { id: id as DocumentId, team };
  }).pipe(Effect.orDie);

const publishedEvent = (options: Parameters<typeof publishedEventOf>[0] = {}) =>
  Effect.map(publishedEventOf(options), ({ id }) => id);

/** The description of an invitation, unfolded and read as text. */
const descriptionOf = (invitation: string) =>
  invitation
    .replace(/\r?\n[ \t]/g, "")
    .match(/^DESCRIPTION:(.*)$/m)?.[1]
    ?.replace(/\\n/g, "\n")
    .replace(/\\,/g, ",");

/** The organizer line of an invitation, unfolded. */
const organizerOf = (invitation: string) =>
  invitation.replace(/\r?\n[ \t]/g, "").match(/^ORGANIZER[^\r\n]*/m)?.[0];

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
      assert.include(invitation, "LOCATION:Kantina");

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

  it.effect("carries the summary in a guest's invitations (AC-3)", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const event = yield* publishedEvent({ summary: "Coffee and a talk." });
      const signup = crypto.randomUUID();
      const address = `gina-${signup}@example.org`;
      const token = yield* attendance.attendAsGuest(
        event,
        { name: "Gina", email: address },
        { id: signup, dietary: "None" },
      );
      const [signedUp] = yield* emailsTo(address, 1);

      yield* attendance.leaveAsGuest(event, token);
      const [, cancelled] = yield* emailsTo(address, 2);
      const link = `${process.env.SITE_URL}/events/${event}`;
      for (const email of [signedUp, cancelled]) {
        assert.strictEqual(
          descriptionOf(email?.message.calendar?.content ?? ""),
          `Coffee and a talk.\n\n${link}`,
        );
      }
    }),
  );

  it.effect("writes in the language each signed up in", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const event = yield* publishedEvent();
      const address = `nora-${crypto.randomUUID()}@example.org`;
      const token = yield* attendance.attendAsGuest(
        event,
        { name: "Nora", email: address },
        { locale: "nb" },
      );
      const [signedUp] = yield* emailsTo(address, 1);
      assert.strictEqual(signedUp?.message.subject, "Du er påmeldt: Launch");
      assert.include(signedUp?.message.text ?? "", "Hei Nora,");
      // Dates as Norwegians write them, in the event's zone.
      assert.include(
        signedUp?.message.text ?? "",
        "onsdag 15. oktober 2036, 18:00–21:00 (sentraleuropeisk tid)",
      );
      assert.include(signedUp?.message.html ?? "", 'lang="nb"');

      // Nynorsk, for a guest who said so.
      const other = `nils-${crypto.randomUUID()}@example.org`;
      const nils = yield* attendance.attendAsGuest(
        event,
        { name: "Nils", email: other },
        { locale: "nn" },
      );
      yield* attendance.leaveAsGuest(event, nils);
      const [, left] = yield* emailsTo(other, 2);
      assert.strictEqual(left?.message.subject, "Avmeld: Launch");
      assert.include(left?.message.text ?? "", "Du er ikkje lenger påmeld");
      yield* attendance.leaveAsGuest(event, token);
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

  it.effect(
    "tells attendees the new place when the event is somewhere else (AC-5)",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const notifications = yield* Notifications;
        const event = yield* publishedEvent();
        yield* sql`UPDATE events SET place = 'Aula' WHERE id = ${event}`;
        const signup = crypto.randomUUID();
        const address = `gina-${signup}@example.org`;
        const notice = {
          event,
          attendee: { id: signup, name: "Gina", email: address, guest: true },
          version: "1",
          previousPlace: "Kantina",
        };
        yield* notifications.eventChanged(notice);
        yield* notifications.eventChanged(notice);

        const [moved] = yield* emailsTo(address, 1);
        const message = moved?.message;
        assert.strictEqual(message?.subject, "New place: Launch");
        assert.include(message?.text ?? "", "It's now at Aula.");
        assert.include(message?.text ?? "", "It was at Kantina.");
        assert.notInclude(message?.text ?? "", "It was Wednesday");
        assert.strictEqual(message?.calendar?.method, "REQUEST");
        assert.include(message?.calendar?.content ?? "", "LOCATION:Aula");
        yield* Effect.sleep("300 millis");
        assert.strictEqual(outbox.to(address).length, 1);
      }),
  );

  it.effect(
    "tells attendees of both in one email when time and place change (AC-6)",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const notifications = yield* Notifications;
        const event = yield* publishedEvent();
        yield* sql`
        UPDATE events SET place = 'Aula', starts_at = '2036-10-16T18:00+02',
          ends_at = '2036-10-16T21:00+02'
        WHERE id = ${event}
      `;
        const signup = crypto.randomUUID();
        const address = `gina-${signup}@example.org`;
        yield* notifications.eventChanged({
          event,
          attendee: { id: signup, name: "Gina", email: address, guest: true },
          version: "1",
          previously: {
            startsAt: "2036-10-15T16:00:00.000Z",
            endsAt: "2036-10-15T19:00:00.000Z",
          },
          previousPlace: "Kantina",
        });

        const [moved] = yield* emailsTo(address, 1);
        const message = moved?.message;
        assert.strictEqual(message?.subject, "New time and place: Launch");
        assert.match(
          message?.text ?? "",
          /It's now Thursday, October 16, 2036/,
        );
        assert.match(message?.text ?? "", /It was Wednesday, October 15, 2036/);
        assert.include(message?.text ?? "", "Aula");
        assert.include(message?.text ?? "", "It was at Kantina.");
        yield* Effect.sleep("300 millis");
        assert.strictEqual(outbox.to(address).length, 1);
      }),
  );

  it.effect(
    "names no old place when an event published before gets one (AC-5)",
    () =>
      Effect.gen(function* () {
        const notifications = yield* Notifications;
        const event = yield* publishedEvent({ place: "Aula" });
        const signup = crypto.randomUUID();
        const address = `gina-${signup}@example.org`;
        yield* notifications.eventChanged({
          event,
          attendee: { id: signup, name: "Gina", email: address, guest: true },
          version: "1",
          previousPlace: "",
        });

        const [moved] = yield* emailsTo(address, 1);
        assert.strictEqual(moved?.message.subject, "New place: Launch");
        assert.include(moved?.message.text ?? "", "It's now at Aula.");
        assert.notInclude(moved?.message.text ?? "", "It was at");
      }),
  );

  it.effect("tells attendees a deleted event is cancelled, and no more", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const notifications = yield* Notifications;
      const event = yield* publishedEvent();
      yield* sql`UPDATE events SET deleted_at = now() WHERE id = ${event}`;
      const run = crypto.randomUUID();
      const attendee = (who: string) => ({
        id: crypto.randomUUID(),
        name: who,
        email: `${who}-${run}@example.org`,
        guest: true,
      });
      yield* notifications.eventCancelled({
        event,
        attendee: attendee("gina"),
      });
      // Anything else about it, sent late, isn't.
      yield* notifications.signedUp({ event, attendee: attendee("late") });

      const [cancelled] = yield* emailsTo(`gina-${run}@example.org`, 1);
      const message = cancelled?.message;
      assert.strictEqual(message?.subject, "Cancelled: Launch");
      assert.include(message?.text ?? "", "is cancelled");
      // No link: there's nothing to see or change.
      assert.notInclude(message?.text ?? "", "?guest=");
      assert.strictEqual(message?.calendar?.method, "CANCEL");
      assert.include(message?.calendar?.content ?? "", "STATUS:CANCELLED");
      yield* Effect.sleep("300 millis");
      assert.deepStrictEqual(outbox.to(`late-${run}@example.org`), []);
    }),
  );

  it.effect("reminds those who signed up before the day before", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const attendance = yield* Attendance;
      const tomorrow = new Date(Date.now() + 12 * 60 * 60 * 1000);
      const event = yield* publishedEvent({ startsAt: tomorrow });
      const quiet = yield* publishedEvent({
        startsAt: tomorrow,
        reminders: false,
      });
      const later = yield* publishedEvent({
        startsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      });
      const run = crypto.randomUUID();
      const signUp = (event: DocumentId, who: string) =>
        attendance.attendAsGuest(event, {
          name: who,
          email: `${who}-${run}@example.org`,
        });
      yield* signUp(event, "early");
      yield* signUp(event, "late");
      yield* signUp(quiet, "quiet");
      yield* signUp(later, "later");
      // Signed up last week, all but one.
      yield* sql`
        UPDATE attendees SET created_at = now() - interval '7 days'
        WHERE email IN (${`early-${run}@example.org`},
          ${`quiet-${run}@example.org`}, ${`later-${run}@example.org`})
      `;

      const reminded = (who: string) =>
        outbox
          .to(`${who}-${run}@example.org`)
          .filter((sent) => sent.message.subject === "Reminder: Launch");
      // Hourly: the next hour's run sends nothing new.
      yield* Mail.sendReminders;
      yield* Mail.sendReminders;
      const [reminder] = yield* emailsTo(`early-${run}@example.org`, 2).pipe(
        Effect.map(() => reminded("early")),
      );
      assert.include(
        reminder?.message.text ?? "",
        "A reminder: you're signed up",
      );
      // Already in their calendar.
      assert.isUndefined(reminder?.message.calendar);
      yield* Effect.sleep("300 millis");
      assert.strictEqual(reminded("early").length, 1);
      assert.deepStrictEqual(reminded("late"), []);
      assert.deepStrictEqual(reminded("quiet"), []);
      assert.deepStrictEqual(reminded("later"), []);
    }),
  );

  it.effect("tells nothing of a signup that was refused", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const event = yield* publishedEvent({ dietary: true });
      const address = `refused-${crypto.randomUUID()}@example.org`;
      // With more about what they can't eat than is kept.
      const refused = yield* Effect.flip(
        attendance.attendAsGuest(
          event,
          { name: "Rolf", email: address },
          { dietary: "x".repeat(501) },
        ),
      );
      assert.strictEqual(refused._tag, "SignupRejected");
      yield* Effect.sleep("300 millis");
      assert.deepStrictEqual(outbox.to(address), []);
    }),
  );

  it.effect(
    "names the event's team as the organizer of its invitations (AC-5)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const { id: event, team } = yield* publishedEventOf();
        const address = `team-${crypto.randomUUID()}@example.org`;
        const token = yield* attendance.attendAsGuest(event, {
          name: "Tora",
          email: address,
        });
        const [signedUp] = yield* emailsTo(address, 1);
        const sender = /<([^>]+)>/.exec(process.env.EMAIL_FROM ?? "")?.[1];
        assert.match(
          organizerOf(signedUp?.message.calendar?.content ?? "") ?? "",
          new RegExp(`^ORGANIZER;CN="?${team.name}"?:mailto:${sender}$`),
        );

        yield* attendance.leaveAsGuest(event, token);
        const [, cancelled] = yield* emailsTo(address, 2);
        assert.strictEqual(cancelled?.message.calendar?.method, "CANCEL");
        assert.match(
          organizerOf(cancelled?.message.calendar?.content ?? "") ?? "",
          new RegExp(`^ORGANIZER;CN="?${team.name}"?:mailto:${sender}$`),
        );
        // The email itself still comes from the site's address.
        assert.strictEqual(cancelled?.message.from, process.env.EMAIL_FROM);
      }),
  );

  it.effect(
    "names the team by its name now, when the team is renamed (AC-5)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const { id: event, team } = yield* publishedEventOf();
        const address = `renamed-${crypto.randomUUID()}@example.org`;
        const token = yield* attendance.attendAsGuest(event, {
          name: "Rolf",
          email: address,
        });
        yield* emailsTo(address, 1);

        const renamed = `${team.name} renamed`;
        yield* (yield* Teams).rename(team.id, renamed);
        yield* attendance.leaveAsGuest(event, token);
        const [, cancelled] = yield* emailsTo(address, 2);
        assert.include(
          organizerOf(cancelled?.message.calendar?.content ?? "") ?? "",
          renamed,
        );
      }),
  );
});
