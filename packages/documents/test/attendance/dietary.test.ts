import { assert, layer } from "@effect/vitest";
import { Effect, Option } from "effect";
import { SqlClient } from "effect/sql";
import { Attendance } from "../../src/attendance/Attendance.ts";
import {
  alice,
  bob,
  dana,
  dietaryList,
  organizerView,
  problemOf,
  publishedAs,
  publishedEvent,
  setTimes,
  signups,
  TestLayer,
} from "../helpers.ts";

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Dietary preferences", (it) => {
  it.effect(
    "keeps dietary preferences for the event, trimmed, in the order of the text",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({
          public: true,
          guests: true,
          dietary: true,
        });
        assert.isTrue((yield* publishedAs(id, "anyone"))?.askDietary);

        yield* attendance.attend(id, alice, { dietary: " Vegan " });
        yield* attendance.attendAsGuest(
          id,
          { name: "Gina", email: "g@example.org" },
          { dietary: "Fish" },
        );
        assert.deepStrictEqual(yield* dietaryList(id), ["Fish", "Vegan"]);

        // Members-only events can ask too.
        const membersOnly = yield* publishedEvent({
          public: false,
          guests: false,
          dietary: true,
        });
        yield* attendance.attend(membersOnly, bob, { dietary: "Halal" });
        assert.deepStrictEqual(yield* dietaryList(membersOnly), ["Halal"]);
      }),
  );

  it.effect(
    "keeps a dietary preference once, and none from a refused signup",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({
          public: true,
          guests: true,
          dietary: true,
        });
        yield* attendance.attend(id, alice, { dietary: "Vegan" });
        yield* attendance.attend(id, alice, { dietary: "Vegan" });
        assert.deepStrictEqual(yield* dietaryList(id), ["Vegan"]);

        yield* attendance.attendAsGuest(
          id,
          { name: "Gina", email: "g@example.org" },
          { dietary: "Fish" },
        );
        const taken = yield* Effect.flip(
          attendance.attendAsGuest(
            id,
            { name: "Gina", email: "g@example.org" },
            { dietary: "Nuts" },
          ),
        );
        assert.deepStrictEqual(problemOf(taken), { _tag: "EmailTaken" });
        assert.deepStrictEqual(yield* dietaryList(id), ["Fish", "Vegan"]);
      }),
  );

  it.effect(
    "keeps nothing that says who gave a dietary preference or when",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const columns = yield* sql<{ column_name: string }>`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'dietary_preferences'
          ORDER BY column_name
        `;
        assert.deepStrictEqual(
          columns.map((column) => column.column_name),
          ["event_id", "id", "text"],
        );
        const [id] = yield* sql<{ column_default: string }>`
          SELECT column_default FROM information_schema.columns
          WHERE table_name = 'dietary_preferences' AND column_name = 'id'
        `;
        assert.strictEqual(id?.column_default, "gen_random_uuid()");
      }),
  );

  it.effect(
    "refuses a dietary preference over 500 characters, and keeps nothing",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({
          public: true,
          guests: true,
          dietary: true,
        });
        const member = yield* Effect.flip(
          attendance.attend(id, alice, { dietary: "x".repeat(501) }),
        );
        assert.strictEqual(member._tag, "SignupRejected");
        assert.deepStrictEqual(problemOf(member), { _tag: "DietaryTooLong" });
        const guest = yield* Effect.flip(
          attendance.attendAsGuest(
            id,
            { name: "Gina", email: "g@example.org" },
            { dietary: "x".repeat(501) },
          ),
        );
        assert.deepStrictEqual(problemOf(guest), { _tag: "DietaryTooLong" });
        assert.deepStrictEqual(yield* organizerView(id), []);
        assert.deepStrictEqual(yield* dietaryList(id), []);

        yield* attendance.attend(id, alice, { dietary: "x".repeat(500) });
        assert.strictEqual((yield* dietaryList(id))[0]?.length, 500);
      }),
  );

  it.effect("signs up without a dietary preference", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({
        public: true,
        guests: true,
        dietary: true,
      });
      yield* attendance.attend(id, alice);
      yield* attendance.attend(id, bob, { dietary: "" });
      yield* attendance.attendAsGuest(
        id,
        { name: "Gina", email: "g@example.org" },
        { dietary: "   " },
      );
      assert.strictEqual((yield* organizerView(id)).length, 3);
      assert.deepStrictEqual(yield* dietaryList(id), []);
    }),
  );

  it.effect("takes dietary preferences only while the event serves food", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const plain = yield* publishedEvent({ public: true, guests: true });
      yield* attendance.attend(plain, alice, { dietary: "Vegan" });
      yield* attendance.attendAsGuest(
        plain,
        { name: "Gus", email: "gus@example.org" },
        { dietary: "Vegan" },
      );

      const late = yield* publishedEvent({
        public: true,
        guests: true,
        dietary: true,
        edit: (event) =>
          setTimes(event, {
            foodDeadline: "2020-01-15T12:00+01:00[Europe/Oslo]",
          }),
      });
      const published = yield* publishedAs(late, "anyone");
      assert.strictEqual(
        published?.foodDeadline?.toISOString(),
        "2020-01-15T11:00:00.000Z",
      );
      // Still open to sign up; dietary preferences are no longer taken.
      yield* attendance.attend(late, alice);
      yield* attendance.attend(late, bob, { dietary: "Vegan" });

      assert.strictEqual((yield* organizerView(plain)).length, 2);
      assert.strictEqual((yield* organizerView(late)).length, 2);
      assert.deepStrictEqual(yield* dietaryList(plain), []);
      assert.deepStrictEqual(yield* dietaryList(late), []);
    }),
  );

  it.effect("lists dietary preferences by the text, not the order given", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({
        public: true,
        guests: true,
        dietary: true,
      });
      yield* attendance.attend(id, alice, { dietary: "Vegan" });
      yield* attendance.attend(id, bob, { dietary: "fish" });
      yield* attendance.attend(id, dana, { dietary: "Apple" });
      assert.deepStrictEqual(yield* dietaryList(id), [
        "Apple",
        "fish",
        "Vegan",
      ]);
    }),
  );

  it.effect("gives no dietary preference with a signup's details", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({
        public: true,
        guests: true,
        dietary: true,
      });
      yield* attendance.attend(id, alice, { dietary: "Vegan" });
      const details = yield* organizerView(id);
      assert.strictEqual(details.length, 1);
      assert.isFalse(
        details.some((each) => each !== null && "dietary" in each),
      );
    }),
  );

  it.effect(
    "leaves dietary preferences as they are when signups change, cancel or are removed",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({
          public: true,
          guests: true,
          dietary: true,
        });
        yield* attendance.attend(id, alice, { dietary: "Vegan" });
        const token = yield* attendance.attendAsGuest(
          id,
          { name: "Gina", email: "g@example.org" },
          { dietary: "Fish" },
        );
        yield* attendance.attend(id, bob, { dietary: "Nuts" });
        const all = ["Fish", "Nuts", "Vegan"];

        yield* attendance.change(id, { user: alice }, { dietary: "Halal" });
        assert.deepStrictEqual(yield* dietaryList(id), all);
        yield* attendance.change(id, { cancelToken: token }, {});
        assert.deepStrictEqual(yield* dietaryList(id), all);
        yield* attendance.leave(id, alice);
        assert.deepStrictEqual(yield* dietaryList(id), all);
        yield* attendance.leaveAsGuest(id, token);
        assert.deepStrictEqual(yield* dietaryList(id), all);

        const [remaining] = yield* signups(id, Option.some(alice));
        yield* attendance.remove(remaining?.id ?? "");
        assert.deepStrictEqual(yield* organizerView(id), []);
        assert.deepStrictEqual(yield* dietaryList(id), all);
      }),
  );
});
