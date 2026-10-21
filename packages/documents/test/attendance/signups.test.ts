import { assert, layer } from "@effect/vitest";
import { Effect, Option, Ref } from "effect";
import { SqlClient } from "effect/sql";
import { Attendance } from "../../src/attendance/Attendance.ts";
import { Documents } from "../../src/events/Documents.ts";
import type { Answers, DocumentId } from "../../src/Model.ts";
import { NoticesKept } from "../../src/notices/Notifications.ts";
import {
  alice,
  bob,
  interruptedWhileLocked,
  openEditor,
  organizerView,
  publishedAs,
  publishedEvent,
  setQuestions,
  setTimes,
  signups,
  TestLayer,
} from "../helpers.ts";

/** The notices that told `signup` it was taken off `event`. */
const removalsOf = (event: DocumentId, signup: string) =>
  Effect.gen(function* () {
    const kept = yield* NoticesKept;
    return (yield* Ref.get(kept)).filter(
      (notice) =>
        notice.kind === "signupRemoved" &&
        notice.event === event &&
        notice.attendee.id === signup,
    );
  });

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

  it.effect(
    "lets people change their answers until sign-up closes (AC-10)",
    () =>
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

        // Nobody has changed anything: the change time is the sign-up time.
        const before = yield* signups(id, Option.some(alice));
        assert.strictEqual(before.length, 2);
        for (const row of before) {
          assert.strictEqual(row.changedAt.getTime(), row.signedUpAt.getTime());
        }

        // The clock ticks in milliseconds: let it.
        yield* Effect.sleep("20 millis");
        yield* attendance.change(
          id,
          { user: alice },
          { answers: { [size]: large } },
        );
        const [member] = (yield* signups(id, Option.some(alice))).filter(
          (row) => row.mine,
        );
        const first = before.find((row) => row.mine);
        assert.isDefined(member);
        assert.isDefined(first);
        assert.strictEqual(
          member?.signedUpAt.getTime(),
          first?.signedUpAt.getTime(),
        );
        assert.isAbove(
          member?.changedAt.getTime() ?? 0,
          member?.signedUpAt.getTime() ?? 0,
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
          attendance.change(
            id,
            { user: alice },
            { answers: { [size]: large } },
          ),
        );
        assert.strictEqual(closed.message, "Sign-up for this event has closed");
      }),
  );

  it.effect("lets organizers take people off, whenever", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({ public: true, guests: true });
      const gina = crypto.randomUUID();
      yield* attendance.attend(id, alice);
      yield* attendance.attendAsGuest(
        id,
        { name: "Gina", email: "gina@example.org" },
        { id: gina, locale: "nb" },
      );
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

      // Alice has no email to tell; Gina is told, in the language she
      // signed up in.
      assert.deepStrictEqual(yield* removalsOf(id, first?.id ?? ""), []);
      yield* attendance.remove(gina);
      const [told, ...more] = yield* removalsOf(id, gina);
      assert.deepStrictEqual(more, []);
      assert.strictEqual(told?.attendee.email, "gina@example.org");
      assert.strictEqual(told?.attendee.locale, "nb");
      assert.isTrue(told?.attendee.guest);
    }),
  );

  it.effect("tells no one taken off an event that has ended (AC-5)", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({ public: true, guests: true });
      const gina = crypto.randomUUID();
      yield* attendance.attendAsGuest(
        id,
        { name: "Gina", email: "gina@example.org" },
        { id: gina },
      );
      // Both at once: an event must end after it starts.
      yield* sql`
        UPDATE events
        SET starts_at = now() - interval '2 hours',
            ends_at = now() - interval '1 hour'
        WHERE id = ${id}
      `;

      yield* attendance.remove(gina);
      assert.deepStrictEqual(yield* organizerView(id), []);
      assert.deepStrictEqual(yield* removalsOf(id, gina), []);
    }),
  );

  it.effect("tells someone taken off an event that is under way (AC-5)", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({ public: true, guests: true });
      const gina = crypto.randomUUID();
      yield* attendance.attendAsGuest(
        id,
        { name: "Gina", email: "gina@example.org" },
        { id: gina },
      );
      yield* sql`
        UPDATE events
        SET starts_at = now() - interval '1 hour',
            ends_at = now() + interval '1 hour'
        WHERE id = ${id}
      `;

      yield* attendance.remove(gina);
      assert.strictEqual((yield* removalsOf(id, gina)).length, 1);
    }),
  );

  it.effect(
    "finishes a removal whose caller went away part way, telling once (AC-6)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: true, guests: true });
        const gina = crypto.randomUUID();
        yield* attendance.attendAsGuest(
          id,
          { name: "Gina", email: "gina@example.org" },
          { id: gina },
        );

        yield* interruptedWhileLocked("attendees", attendance.remove(gina));
        assert.deepStrictEqual(yield* organizerView(id), []);
        assert.strictEqual((yield* removalsOf(id, gina)).length, 1);

        const again = yield* Effect.flip(attendance.remove(gina));
        assert.strictEqual(again._tag, "SignupNotFound");
        assert.strictEqual((yield* removalsOf(id, gina)).length, 1);
      }),
  );
});
