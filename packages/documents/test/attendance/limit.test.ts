import { assert, layer } from "@effect/vitest";
import type { Identity } from "@skjera/oauth/api";
import { Deferred, Effect, Fiber } from "effect";
import { SqlClient } from "effect/sql";
import { Attendance } from "../../src/attendance/Attendance.ts";
import { Documents } from "../../src/events/Documents.ts";
import {
  alice,
  bob,
  dana,
  newTeam,
  openEditor,
  organizerView,
  publishedAs,
  publishedEvent,
  setLimit,
  TestLayer,
} from "../helpers.ts";

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Attendance limit", (it) => {
  it.effect(
    "publishes the limit and whether places left are hidden, none and shown when unset (AC-1)",
    () =>
      Effect.gen(function* () {
        const limited = yield* publishedEvent({
          public: true,
          guests: false,
          edit: (event) => {
            setLimit(event, 30);
            (event as { hidePlacesLeft?: boolean }).hidePlacesLeft = true;
          },
        });
        const row = yield* publishedAs(limited, "anyone");
        assert.strictEqual(row?.maxAttendees, 30);
        assert.isTrue(row?.hidePlacesLeft);

        // A new event, or a draft from before, has neither.
        const unset = yield* publishedEvent({ public: true, guests: false });
        const bare = yield* publishedAs(unset, "anyone");
        assert.isNull(bare?.maxAttendees);
        assert.isFalse(bare?.hidePlacesLeft);
      }),
  );

  it.effect("takes a limit that is a whole number of at least one (AC-1)", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const accepted = yield* openEditor(id);
      yield* documents.applyChanges(
        id,
        [accepted.edit((event) => setLimit(event, 1))],
        alice,
      );
      for (const limit of [0, -1, 1.5]) {
        const editor = yield* openEditor(id);
        const error = yield* Effect.flip(
          documents.applyChanges(
            id,
            [editor.edit((event) => setLimit(event, limit))],
            alice,
          ),
        );
        assert.strictEqual(error._tag, "InvalidContent", String(limit));
      }
      const removing = yield* openEditor(id);
      yield* documents.applyChanges(
        id,
        [removing.edit((event) => setLimit(event, null))],
        alice,
      );
    }),
  );

  it.effect("counts members and guests together against the limit (AC-2)", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({
        public: true,
        guests: true,
        edit: (event) => setLimit(event, 2),
      });
      yield* attendance.attend(id, alice);
      yield* attendance.attendAsGuest(id, {
        name: "Gina",
        email: "gina@example.org",
      });

      const member = yield* Effect.flip(attendance.attend(id, bob));
      assert.strictEqual(member._tag, "SignupRejected");
      const guest = yield* Effect.flip(
        attendance.attendAsGuest(id, { name: "Gus", email: "gus@example.org" }),
      );
      assert.strictEqual(guest._tag, "SignupRejected");
      assert.strictEqual((yield* organizerView(id)).length, 2);
    }),
  );

  it.effect("refuses a signup to a full event, saying it is full (AC-3)", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({
        public: true,
        guests: true,
        edit: (event) => setLimit(event, 1),
      });
      yield* attendance.attend(id, alice);

      for (const refused of [
        attendance.attend(id, bob),
        attendance.attendAsGuest(id, { name: "Gus", email: "gus@example.org" }),
      ] as ReadonlyArray<
        Effect.Effect<
          unknown,
          { readonly _tag: string; readonly problem?: unknown }
        >
      >) {
        const error = yield* Effect.flip(refused);
        assert.deepStrictEqual(
          [error._tag, error.problem, "message" in error && error.message],
          ["SignupRejected", { _tag: "EventFull" }, "This event is full"],
        );
      }
      assert.strictEqual((yield* organizerView(id)).length, 1);
    }),
  );

  it.effect(
    "gives the last place to one of two who sign up at once (AC-4)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const sql = yield* SqlClient.SqlClient;
        const id = yield* publishedEvent({
          public: false,
          guests: false,
          edit: (event) => setLimit(event, 1),
        });

        // A held lock on attendees stops inserts, so both signups have read
        // the event before either inserts.
        const held = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const holder = yield* Effect.gen(function* () {
          yield* sql`LOCK TABLE attendees IN SHARE MODE`;
          yield* Deferred.succeed(held, undefined);
          yield* Deferred.await(release);
        }).pipe(sql.withTransaction, Effect.forkChild);
        yield* Deferred.await(held);

        const outcome = (who: Identity) =>
          attendance.attend(id, who).pipe(
            Effect.as("signed up"),
            Effect.catchTag("SignupRejected", (error) =>
              Effect.succeed(error.problem._tag),
            ),
            Effect.orDie,
          );
        const both = yield* Effect.all([outcome(alice), outcome(bob)], {
          concurrency: "unbounded",
        }).pipe(Effect.forkChild);

        // Wait until both are held up: one on the lock, one on the event.
        const waiting = sql<{ count: number }>`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
        `.pipe(Effect.map(([row]) => row?.count ?? 0));
        while ((yield* waiting) < 2) yield* Effect.sleep("50 millis");
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(holder);

        assert.deepStrictEqual((yield* Fiber.join(both)).sort(), [
          "EventFull",
          "signed up",
        ]);
        assert.strictEqual((yield* organizerView(id)).length, 1);
      }).pipe(Effect.timeout("10 seconds")),
  );

  it.effect(
    "lets those signed up to a full event sign up again, change and cancel (AC-5)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({
          public: true,
          guests: true,
          dietary: true,
          edit: (event) => setLimit(event, 2),
        });
        yield* attendance.attend(id, alice, { dietary: "None" });
        const token = yield* attendance.attendAsGuest(
          id,
          { name: "Gina", email: "gina@example.org" },
          { dietary: "None" },
        );

        // Nothing changes, and nobody is refused.
        yield* attendance.attend(id, alice, { dietary: "None" });
        yield* attendance.change(id, { user: alice }, {});
        yield* attendance.change(id, { cancelToken: token }, {});
        assert.strictEqual((yield* organizerView(id)).length, 2);

        yield* attendance.leave(id, alice);
        yield* attendance.leaveAsGuest(id, token);
        assert.deepStrictEqual(yield* organizerView(id), []);
      }),
  );

  it.effect("accepts a signup for a place a cancel freed (AC-6)", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({
        public: false,
        guests: false,
        edit: (event) => setLimit(event, 1),
      });
      yield* attendance.attend(id, alice);
      const refused = yield* Effect.flip(attendance.attend(id, bob));
      assert.strictEqual(refused._tag, "SignupRejected");

      yield* attendance.leave(id, alice);
      yield* attendance.attend(id, bob);
      assert.deepStrictEqual(
        (yield* organizerView(id)).map((each) => each?.name),
        ["bob"],
      );
    }),
  );

  it.effect(
    "publishes a limit below those signed up, and refuses until enough cancel (AC-9)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: false, guests: false });
        yield* attendance.attend(id, alice);
        yield* attendance.attend(id, bob);

        const editor = yield* openEditor(id);
        const heads = yield* documents.applyChanges(
          id,
          [editor.edit((event) => setLimit(event, 1))],
          alice,
        );
        yield* documents.publish(id, heads, alice);
        assert.strictEqual(
          (yield* publishedAs(id, "members"))?.maxAttendees,
          1,
        );
        assert.strictEqual((yield* organizerView(id)).length, 2);

        const refused = () => Effect.flip(attendance.attend(id, dana));
        assert.strictEqual((yield* refused())._tag, "SignupRejected");
        yield* attendance.leave(id, bob);
        assert.strictEqual((yield* refused())._tag, "SignupRejected");
        yield* attendance.leave(id, alice);
        yield* attendance.attend(id, dana);
        assert.strictEqual((yield* organizerView(id)).length, 1);
      }),
  );
});
