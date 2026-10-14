import { assert, layer } from "@effect/vitest";
import { Effect } from "effect";
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
});
