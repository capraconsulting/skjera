import { assert, describe, it, layer } from "@effect/vitest";
import { Cron, Effect } from "effect";
import { SqlClient } from "effect/sql";
import { Attendance } from "../../src/attendance/Attendance.ts";
import type { DocumentId } from "../../src/Model.ts";
import * as Mail from "../../src/notices/Mail.tsx";
import { Notifications } from "../../src/notices/Notifications.ts";
import { emailsTo, outbox, publishedEvent, TestLayer } from "./helpers.ts";

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Mail: changes", (it) => {
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
    "tells attendees the new place when the event is somewhere else",
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
    "tells attendees of both in one email when time and place change",
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

  it.effect("names no old place when an event published before gets one", () =>
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

  it.effect(
    "reminds everyone signed up for the next Norwegian day, same-day signups included",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const attendance = yield* Attendance;
        // The next day, 26 March, is 23 hours long: the clocks go forward.
        const now = new Date("2045-03-25T07:05:00Z");
        const firstThing = yield* publishedEvent({
          startsAt: new Date("2045-03-26T00:30+01:00"),
        });
        const lastThing = yield* publishedEvent({
          startsAt: new Date("2045-03-26T23:30+02:00"),
        });
        const today = yield* publishedEvent({
          startsAt: new Date("2045-03-25T20:00+01:00"),
        });
        const dayAfter = yield* publishedEvent({
          startsAt: new Date("2045-03-27T00:30+02:00"),
        });
        const deleted = yield* publishedEvent({
          startsAt: new Date("2045-03-26T12:00+02:00"),
        });
        const quiet = yield* publishedEvent({
          startsAt: new Date("2045-03-26T12:00+02:00"),
          reminders: false,
        });
        const run = crypto.randomUUID();
        const signUp = (event: DocumentId, who: string) =>
          attendance.attendAsGuest(event, {
            name: who,
            email: `${who}-${run}@example.org`,
          });
        yield* signUp(firstThing, "first");
        yield* signUp(firstThing, "sameday");
        yield* signUp(lastThing, "last");
        yield* signUp(today, "today");
        yield* signUp(dayAfter, "dayafter");
        yield* signUp(deleted, "deleted");
        yield* signUp(quiet, "quiet");
        yield* sql`UPDATE events SET deleted_at = now() WHERE id = ${deleted}`;
        // Signed up an hour before the run.
        yield* sql`
          UPDATE attendees SET created_at = '2045-03-25T06:05:00Z'
          WHERE email = ${`sameday-${run}@example.org`}
        `;

        const reminded = (who: string) =>
          outbox
            .to(`${who}-${run}@example.org`)
            .filter((sent) => sent.message.subject === "Reminder: Launch");
        // Once a day: running it again sends nothing new.
        yield* Mail.sendReminders(now);
        yield* Mail.sendReminders(now);
        for (const who of ["first", "sameday", "last"]) {
          yield* emailsTo(`${who}-${run}@example.org`, 2);
        }
        const [reminder] = reminded("first");
        assert.include(
          reminder?.message.text ?? "",
          "A reminder: you're signed up",
        );
        // Already in their calendar.
        assert.isUndefined(reminder?.message.calendar);
        yield* Effect.sleep("300 millis");
        for (const who of ["first", "sameday", "last"]) {
          assert.strictEqual(reminded(who).length, 1, who);
        }
        for (const who of ["today", "dayafter", "deleted", "quiet"]) {
          assert.deepStrictEqual(reminded(who), [], who);
        }
      }),
  );

  it.effect(
    "reminds once for each time the event starts, and again when it moves to another day",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const attendance = yield* Attendance;
        const now = new Date("2045-03-25T07:05:00Z");
        const event = yield* publishedEvent({
          startsAt: new Date("2045-03-26T12:00+02:00"),
        });
        const run = crypto.randomUUID();
        const address = `once-${run}@example.org`;
        yield* attendance.attendAsGuest(event, {
          name: "once",
          email: address,
        });
        const reminded = () =>
          outbox
            .to(address)
            .filter((sent) => sent.message.subject === "Reminder: Launch");

        yield* Mail.sendReminders(now);
        yield* Mail.sendReminders(now);
        yield* emailsTo(address, 2);
        yield* Effect.sleep("300 millis");
        assert.strictEqual(reminded().length, 1);

        // Moved to the following day: the next morning's run reminds again.
        yield* sql`
          UPDATE events SET starts_at = '2045-03-27T12:00+02',
            ends_at = '2045-03-27T15:00+02'
          WHERE id = ${event}
        `;
        const nextMorning = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        yield* Mail.sendReminders(nextMorning);
        yield* Mail.sendReminders(nextMorning);
        yield* emailsTo(address, 3);
        yield* Effect.sleep("300 millis");
        assert.strictEqual(reminded().length, 2);
      }),
  );
});

describe("The reminder schedule", () => {
  it("runs at 07:05 UTC whatever zone the process is in", () => {
    const before = process.env.TZ;
    process.env.TZ = "Europe/Oslo";
    try {
      assert.strictEqual(
        Cron.next(
          Mail.reminderSchedule,
          new Date("2026-03-30T06:30:00Z"),
        ).toISOString(),
        "2026-03-30T07:05:00.000Z",
      );
      assert.strictEqual(
        Cron.next(
          Mail.reminderSchedule,
          new Date("2026-03-30T07:05:01Z"),
        ).toISOString(),
        "2026-03-31T07:05:00.000Z",
      );
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });
});
