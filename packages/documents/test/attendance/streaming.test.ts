import { assert, layer } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Attendance } from "../../src/attendance/Attendance.ts";
import { Documents } from "../../src/events/Documents.ts";
import {
  alice,
  bob,
  dana,
  openEditor,
  organizerView,
  publishedEvent,
  setLimit,
  setStreamed,
  setTimes,
  signups,
  TestLayer,
} from "../helpers.ts";

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("In person or online", (it) => {
  it.effect(
    "refuses a signup to a streamed event without in person or online (AC-3)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({
          public: true,
          guests: true,
          edit: (event) => setStreamed(event, true),
        });
        for (const refused of [
          attendance.attend(id, alice),
          attendance.attendAsGuest(id, {
            name: "Gina",
            email: "gina@example.org",
          }),
        ] as ReadonlyArray<
          Effect.Effect<
            unknown,
            { readonly _tag: string; readonly problem?: unknown }
          >
        >) {
          const error = yield* Effect.flip(refused);
          assert.deepStrictEqual(
            [error._tag, error.problem],
            ["SignupRejected", { _tag: "AttendanceMissing" }],
          );
        }
        assert.deepStrictEqual(yield* organizerView(id), []);
      }),
  );

  it.effect("stores whether each signup is in person or online (AC-3)", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({
        public: true,
        guests: true,
        edit: (event) => setStreamed(event, true),
      });
      yield* attendance.attend(id, alice, { online: true });
      yield* attendance.attendAsGuest(
        id,
        { name: "Gina", email: "gina@example.org" },
        { online: false },
      );
      assert.deepStrictEqual(
        (yield* signups(id, Option.none())).map((row) => row.online),
        [true, false],
      );
    }),
  );

  it.effect("takes a signup to an event not streamed as in person (AC-3)", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({ public: true, guests: true });
      yield* attendance.attend(id, alice, { online: true });
      yield* attendance.attendAsGuest(id, {
        name: "Gina",
        email: "gina@example.org",
      });
      assert.deepStrictEqual(
        (yield* signups(id, Option.none())).map((row) => row.online),
        [false, false],
      );
    }),
  );

  it.effect(
    "lets those signed up change between in person and online, and keeps the choice when left out (AC-4)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({
          public: true,
          guests: true,
          edit: (event) => setStreamed(event, true),
        });
        yield* attendance.attend(id, alice, { online: false });
        const token = yield* attendance.attendAsGuest(
          id,
          { name: "Gina", email: "gina@example.org" },
          { online: false },
        );
        const online = () =>
          Effect.map(signups(id, Option.none()), (rows) =>
            rows.map((row) => row.online),
          );

        yield* attendance.change(id, { user: alice }, { online: true });
        yield* attendance.change(id, { cancelToken: token }, { online: true });
        assert.deepStrictEqual(yield* online(), [true, true]);

        yield* attendance.change(id, { user: alice }, { online: false });
        yield* attendance.change(id, { cancelToken: token }, { online: false });
        assert.deepStrictEqual(yield* online(), [false, false]);

        // Left out, the choice stays.
        yield* attendance.change(id, { user: alice }, { online: true });
        yield* attendance.change(id, { user: alice }, {});
        assert.deepStrictEqual(yield* online(), [true, false]);
      }),
  );

  it.effect("refuses a change to online after sign-up closes (AC-4)", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({
        public: false,
        guests: false,
        edit: (event) => setStreamed(event, true),
      });
      yield* attendance.attend(id, alice, { online: false });

      const editor = yield* openEditor(id);
      const heads = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) =>
            setTimes(event, {
              deadline: "2020-01-15T12:00+01:00[Europe/Oslo]",
            }),
          ),
        ],
        alice,
      );
      yield* documents.publish(id, heads, alice);

      const error = yield* Effect.flip(
        attendance.change(id, { user: alice }, { online: true }),
      );
      assert.strictEqual(error._tag, "SignupRejected");
      assert.deepStrictEqual(
        (yield* signups(id, Option.some(alice))).map((row) => row.online),
        [false],
      );
    }),
  );

  it.effect(
    "counts only those in person against the limit of a streamed event (AC-6)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({
          public: true,
          guests: true,
          edit: (event) => {
            setStreamed(event, true);
            setLimit(event, 1);
          },
        });
        yield* attendance.attend(id, alice, { online: false });

        for (const refused of [
          attendance.attend(id, bob, { online: false }),
          attendance.attendAsGuest(
            id,
            { name: "Gus", email: "gus@example.org" },
            { online: false },
          ),
        ] as ReadonlyArray<
          Effect.Effect<
            unknown,
            { readonly _tag: string; readonly problem?: unknown }
          >
        >) {
          const error = yield* Effect.flip(refused);
          assert.deepStrictEqual(
            [error._tag, error.problem],
            ["SignupRejected", { _tag: "EventFull" }],
          );
        }

        // Online takes no place, so a full event takes it.
        yield* attendance.attend(id, bob, { online: true });
        assert.strictEqual((yield* organizerView(id)).length, 2);
      }),
  );

  it.effect(
    "takes someone in person when only those online fill the limit (AC-6)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({
          public: true,
          guests: true,
          edit: (event) => {
            setStreamed(event, true);
            setLimit(event, 1);
          },
        });
        yield* attendance.attend(id, alice, { online: true });
        yield* attendance.attend(id, bob, { online: true });
        yield* attendance.attendAsGuest(
          id,
          { name: "Gina", email: "gina@example.org" },
          { online: false },
        );
        assert.strictEqual((yield* organizerView(id)).length, 3);
      }),
  );

  it.effect(
    "refuses a change to in person when no place is left, until one is free (AC-6)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({
          public: false,
          guests: false,
          edit: (event) => {
            setStreamed(event, true);
            setLimit(event, 1);
          },
        });
        yield* attendance.attend(id, alice, { online: false });
        yield* attendance.attend(id, bob, { online: true });
        const online = () =>
          Effect.map(signups(id, Option.some(alice)), (rows) =>
            rows.map((row) => row.online),
          );

        const error = yield* Effect.flip(
          attendance.change(id, { user: bob }, { online: false }),
        );
        assert.deepStrictEqual(
          [error._tag, "problem" in error && error.problem],
          ["SignupRejected", { _tag: "EventFull" }],
        );
        assert.deepStrictEqual(yield* online(), [false, true]);

        yield* attendance.change(id, { user: alice }, { online: true });
        yield* attendance.change(id, { user: bob }, { online: false });
        assert.deepStrictEqual(yield* online(), [true, false]);
      }),
  );

  it.effect(
    "lets someone in person on a full streamed event stay, saying in person again (AC-6)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const member = yield* publishedEvent({
          public: false,
          guests: false,
          edit: (event) => {
            setStreamed(event, true);
            setLimit(event, 1);
          },
        });
        yield* attendance.attend(member, alice, { online: false });
        yield* attendance.change(member, { user: alice }, { online: false });
        assert.deepStrictEqual(
          (yield* signups(member, Option.some(alice))).map((row) => row.online),
          [false],
        );

        const guest = yield* publishedEvent({
          public: true,
          guests: true,
          edit: (event) => {
            setStreamed(event, true);
            setLimit(event, 1);
          },
        });
        const token = yield* attendance.attendAsGuest(
          guest,
          { name: "Gina", email: "gina@example.org" },
          { online: false },
        );
        yield* attendance.change(
          guest,
          { cancelToken: token },
          { online: false },
        );
        assert.deepStrictEqual(
          (yield* signups(guest, Option.none())).map((row) => row.online),
          [false],
        );
      }),
  );

  it.effect(
    "counts everyone in person once the event is published as not streamed (AC-7)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({
          public: false,
          guests: false,
          edit: (event) => {
            setStreamed(event, true);
            setLimit(event, 1);
          },
        });
        yield* attendance.attend(id, alice, { online: true });

        const editor = yield* openEditor(id);
        const heads = yield* documents.applyChanges(
          id,
          [editor.edit((event) => setStreamed(event, false))],
          alice,
        );
        yield* documents.publish(id, heads, alice);

        for (const online of [false, true]) {
          const error = yield* Effect.flip(
            attendance.attend(id, bob, { online }),
          );
          assert.deepStrictEqual(
            [error._tag, "problem" in error && error.problem],
            ["SignupRejected", { _tag: "EventFull" }],
            String(online),
          );
        }
      }),
  );

  it.effect(
    "counts a signup that says online as in person when not streamed (AC-7)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({
          public: false,
          guests: false,
          edit: (event) => setLimit(event, 2),
        });
        yield* attendance.attend(id, alice);
        yield* attendance.attend(id, bob);
        const error = yield* Effect.flip(
          attendance.attend(id, dana, { online: true }),
        );
        assert.deepStrictEqual(
          [error._tag, "problem" in error && error.problem],
          ["SignupRejected", { _tag: "EventFull" }],
        );
      }),
  );
});
