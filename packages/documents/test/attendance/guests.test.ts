import { assert, layer } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Attendance } from "../../src/Attendance.ts";
import {
  bob,
  organizerView,
  publishedEvent,
  signups,
  TestLayer,
} from "../helpers.ts";

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Guests", (it) => {
  it.effect("lets guests sign up where allowed, once per email", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const closed = yield* publishedEvent({ public: true, guests: false });
      const rejected = yield* Effect.flip(
        attendance.attendAsGuest(closed, {
          name: "Gina",
          email: "gina@example.org",
        }),
      );
      assert.strictEqual(rejected._tag, "SignupRejected");

      const id = yield* publishedEvent({ public: true, guests: true });
      const token = yield* attendance.attendAsGuest(id, {
        name: " Gina ",
        email: "gina@example.org",
      });
      const again = yield* Effect.flip(
        attendance.attendAsGuest(id, {
          name: "Gina again",
          email: "GINA@example.org",
        }),
      );
      assert.strictEqual(again._tag, "SignupRejected");
      yield* attendance.attend(id, bob);

      assert.deepStrictEqual(
        (yield* organizerView(id)).map((each) => [each?.name, each?.guest]),
        [
          ["Gina", true],
          ["bob", false],
        ],
      );
      // Anyone else can count them, but not see who they are.
      assert.deepStrictEqual(
        (yield* signups(id, Option.none())).map((row) => row.details),
        [null, null],
      );

      // Only the token given to the guest cancels their signup.
      const wrong = yield* Effect.flip(attendance.leaveAsGuest(id, "guess"));
      assert.strictEqual(wrong._tag, "SignupNotFound");
      const elsewhere = yield* Effect.flip(
        attendance.leaveAsGuest(closed, token),
      );
      assert.strictEqual(elsewhere._tag, "SignupNotFound");
      yield* attendance.leaveAsGuest(id, token);
      assert.strictEqual((yield* signups(id, Option.none())).length, 1);
    }),
  );

  it.effect("keeps a guest's phone number and company, trimmed (AC-2)", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({ public: true, guests: true });
      yield* attendance.attendAsGuest(id, {
        name: "Gina",
        email: "gina@example.org",
        phone: " +47 900 00 000 ",
        company: " Acme ",
      });
      assert.deepStrictEqual(
        (yield* organizerView(id)).map((each) => [each?.phone, each?.company]),
        [["+47 900 00 000", "Acme"]],
      );
    }),
  );

  it.effect(
    "keeps nothing for a phone number and company left blank (AC-2)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: true, guests: true });
        yield* attendance.attendAsGuest(id, {
          name: "Gina",
          email: "gina@example.org",
          company: "  ",
        });
        assert.deepStrictEqual(
          (yield* organizerView(id)).map((each) => [
            each?.phone,
            each?.company,
          ]),
          [[null, null]],
        );
      }),
  );

  it.effect(
    "lets a guest change their phone number and company, and keeps them when left out (AC-3)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: true, guests: true });
        const token = yield* attendance.attendAsGuest(id, {
          name: "Gina",
          email: "gina@example.org",
          phone: "111",
          company: "Acme",
        });
        const contact = () =>
          Effect.map(organizerView(id), (rows) =>
            rows.map((each) => [each?.phone, each?.company]),
          );

        yield* attendance.change(
          id,
          { cancelToken: token },
          { phone: " 222 ", company: "Initech" },
        );
        assert.deepStrictEqual(yield* contact(), [["222", "Initech"]]);

        yield* attendance.change(id, { cancelToken: token }, { phone: "" });
        assert.deepStrictEqual(yield* contact(), [[null, "Initech"]]);

        yield* attendance.change(id, { cancelToken: token }, {});
        assert.deepStrictEqual(yield* contact(), [[null, "Initech"]]);
      }),
  );

  it.effect("gives a member's signup no phone number or company (AC-5)", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({ public: true, guests: true });
      yield* attendance.attend(id, bob);
      yield* attendance.change(
        id,
        { user: bob },
        { phone: "111", company: "Acme" },
      );
      assert.deepStrictEqual(
        (yield* organizerView(id)).map((each) => [each?.phone, each?.company]),
        [[null, null]],
      );
    }),
  );
});
