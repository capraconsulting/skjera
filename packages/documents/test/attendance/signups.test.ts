import { assert, layer } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Attendance } from "../../src/Attendance.ts";
import { Documents } from "../../src/Documents.ts";
import type { Answers } from "../../src/Model.ts";
import {
  alice,
  bob,
  openEditor,
  organizerView,
  publishedAs,
  publishedEvent,
  setQuestions,
  setTimes,
  signups,
  TestLayer,
} from "../helpers.ts";

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Attendance", (it) => {
  it.effect("shows members-only events to signed-in users only", () =>
    Effect.gen(function* () {
      const membersOnly = yield* publishedEvent({
        public: false,
        guests: true,
      });
      const open = yield* publishedEvent({ public: true, guests: true });

      assert.isUndefined(yield* publishedAs(membersOnly, "anyone"));
      const seen = yield* publishedAs(membersOnly, "members");
      // Guests only ever apply to public events.
      assert.isFalse(seen?.isPublic);
      assert.isFalse(seen?.allowGuests);
      assert.isTrue((yield* publishedAs(open, "anyone"))?.allowGuests);
    }),
  );

  it.effect("lets members sign up and change their mind", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({ public: false, guests: false });

      yield* attendance.attend(id, alice);
      yield* attendance.attend(id, alice);
      yield* attendance.attend(id, bob);
      const forAlice = yield* signups(id, Option.some(alice));
      assert.strictEqual(forAlice.length, 2);
      assert.deepStrictEqual(
        forAlice.map((row) => row.mine),
        [true, false],
      );

      yield* attendance.leave(id, alice);
      const after = yield* signups(id, Option.some(alice));
      assert.strictEqual(after.length, 1);
      assert.isFalse(after[0]?.mine);

      // Members-only events don't exist for anyone signed out.
      assert.deepStrictEqual(yield* signups(id, Option.none()), []);
    }),
  );

  it.effect("closes signing up and cancelling at the deadline", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({ public: true, guests: true });
      yield* attendance.attend(id, alice);
      const token = yield* attendance.attendAsGuest(id, {
        name: "Gina",
        email: "gina@example.org",
      });

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

      for (const refused of [
        attendance.attend(id, bob),
        attendance.leave(id, alice),
        attendance.attendAsGuest(id, { name: "Gus", email: "gus@example.org" }),
        attendance.leaveAsGuest(id, token),
      ] as ReadonlyArray<Effect.Effect<unknown, { readonly _tag: string }>>) {
        const error = yield* Effect.flip(refused);
        assert.deepStrictEqual(
          [error._tag, "message" in error ? error.message : undefined],
          ["SignupRejected", "Sign-up for this event has closed"],
        );
      }
      assert.strictEqual((yield* organizerView(id)).length, 2);
    }),
  );

  it.effect("gives guests a token that emails sent later can carry", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({ public: true, guests: true });
      const signup = crypto.randomUUID();
      const token = yield* attendance.attendAsGuest(
        id,
        { name: "Gina", email: "gina@example.org" },
        { id: signup },
      );
      // The same, made again from the signup alone; another's differs.
      assert.strictEqual(attendance.guestToken(signup), token);
      assert.notStrictEqual(attendance.guestToken(crypto.randomUUID()), token);
      yield* attendance.leaveAsGuest(id, attendance.guestToken(signup));
      assert.deepStrictEqual(yield* organizerView(id), []);
    }),
  );

  it.effect("asks the event's questions, and keeps the answers as given", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const [where, swim, size, friend] = [
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
      ];
      const [small, large] = [crypto.randomUUID(), crypto.randomUUID()];
      const id = yield* publishedEvent({
        public: true,
        guests: true,
        edit: (event) =>
          setQuestions(event, [
            { id: where, type: "text", text: "Where did you hear of it?" },
            {
              id: swim,
              type: "checkbox",
              text: "I accept the risks of swimming",
              required: true,
            },
            {
              id: size,
              type: "choice",
              text: "Towel size",
              required: true,
              options: [
                { id: small, text: "Small" },
                { id: large, text: "Large" },
              ],
            },
            { id: friend, type: "checkbox", text: "I bring a friend" },
          ]),
      });
      assert.deepStrictEqual(
        (yield* publishedAs(id, "anyone"))?.questions.map((q) => q.text),
        [
          "Where did you hear of it?",
          "I accept the risks of swimming",
          "Towel size",
          "I bring a friend",
        ],
      );

      const refused = (answers: Answers) =>
        Effect.flip(attendance.attend(id, alice, { answers })).pipe(
          Effect.map((error) => error.message),
        );
      assert.strictEqual(
        yield* refused({ [size]: small }),
        "Tick “I accept the risks of swimming” to sign up",
      );
      assert.strictEqual(
        yield* refused({ [swim]: true }),
        "Answer “Towel size”",
      );
      assert.strictEqual(
        yield* refused({ [swim]: true, [size]: "medium" }),
        "Pick one of the answers to “Towel size”",
      );
      assert.strictEqual(
        yield* refused({
          [swim]: true,
          [size]: small,
          [where]: "x".repeat(1001),
        }),
        "Keep your answer to “Where did you hear of it?” shorter",
      );

      yield* attendance.attend(id, alice, {
        answers: {
          [swim]: true,
          [size]: large,
          [where]: " A poster ",
          other: "x",
        },
      });
      yield* attendance.attendAsGuest(
        id,
        { name: "Gina", email: "gina@example.org" },
        { answers: { [swim]: true, [size]: small, [friend]: true } },
      );
      assert.deepStrictEqual(
        (yield* organizerView(id)).map((each) => each?.answers),
        [
          [
            {
              id: where,
              question: "Where did you hear of it?",
              answer: "A poster",
              value: "A poster",
            },
            {
              id: swim,
              question: "I accept the risks of swimming",
              answer: "Yes",
              value: true,
            },
            { id: size, question: "Towel size", answer: "Large", value: large },
            {
              id: friend,
              question: "I bring a friend",
              answer: "No",
              value: false,
            },
          ],
          [
            {
              id: swim,
              question: "I accept the risks of swimming",
              answer: "Yes",
              value: true,
            },
            { id: size, question: "Towel size", answer: "Small", value: small },
            {
              id: friend,
              question: "I bring a friend",
              answer: "Yes",
              value: true,
            },
          ],
        ],
      );
    }),
  );

  it.effect("lets people change their answers until sign-up closes", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const attendance = yield* Attendance;
      const size = crypto.randomUUID();
      const [small, large] = [crypto.randomUUID(), crypto.randomUUID()];
      const id = yield* publishedEvent({
        public: true,
        guests: true,
        dietary: true,
        edit: (event) =>
          setQuestions(event, [
            {
              id: size,
              type: "choice",
              text: "Towel size",
              required: true,
              options: [
                { id: small, text: "Small" },
                { id: large, text: "Large" },
              ],
            },
          ]),
      });
      yield* attendance.attend(id, alice, { answers: { [size]: small } });
      const token = yield* attendance.attendAsGuest(
        id,
        { name: "Gina", email: "gina@example.org" },
        { answers: { [size]: small } },
      );
      const view = Effect.map(organizerView(id), (rows) =>
        rows.map((each) => each?.answers[0]?.answer),
      );

      yield* attendance.change(
        id,
        { user: alice },
        { answers: { [size]: large } },
      );
      yield* attendance.change(
        id,
        { cancelToken: token },
        { answers: { [size]: large } },
      );
      assert.deepStrictEqual(yield* view, ["Large", "Large"]);

      // Changes are checked like signups, and need a signup to change.
      const invalid = yield* Effect.flip(
        attendance.change(id, { user: alice }, { answers: {} }),
      );
      assert.strictEqual(invalid.message, "Answer “Towel size”");
      const nobody = yield* Effect.flip(
        attendance.change(id, { user: bob }, { answers: { [size]: small } }),
      );
      assert.strictEqual(nobody._tag, "SignupNotFound");
      const wrongToken = yield* Effect.flip(
        attendance.change(
          id,
          { cancelToken: "guess" },
          { answers: { [size]: small } },
        ),
      );
      assert.strictEqual(wrongToken._tag, "SignupNotFound");

      const editor = yield* openEditor(id);

      // Not after sign-up closes.
      const closing = yield* documents.applyChanges(
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
      yield* documents.publish(id, closing, alice);
      const closed = yield* Effect.flip(
        attendance.change(id, { user: alice }, { answers: { [size]: large } }),
      );
      assert.strictEqual(closed.message, "Sign-up for this event has closed");
    }),
  );

  it.effect("lets organizers take people off, whenever", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({ public: true, guests: true });
      yield* attendance.attend(id, alice);
      yield* attendance.attendAsGuest(id, {
        name: "Gina",
        email: "gina@example.org",
      });
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

      const [first] = yield* signups(id, Option.some(alice));
      assert.isDefined(first);
      yield* attendance.remove(first?.id ?? "");
      assert.deepStrictEqual(
        (yield* organizerView(id)).map((each) => each?.name),
        ["Gina"],
      );
      const again = yield* Effect.flip(attendance.remove(first?.id ?? ""));
      assert.strictEqual(again._tag, "SignupNotFound");
    }),
  );
});
