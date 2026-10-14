import { assert, layer } from "@effect/vitest";
import { Effect } from "effect";
import { Attendance } from "../../src/attendance/Attendance.ts";
import { Teams } from "../../src/Teams.ts";
import {
  emailsTo,
  organizerOf,
  outbox,
  publishedEvent,
  publishedEventOf,
  TestLayer,
} from "./helpers.ts";

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Mail: organizer", (it) => {
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
