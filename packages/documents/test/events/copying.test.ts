import { isDeepStrictEqual } from "node:util";
import * as A from "@automerge/automerge";
import { assert, layer } from "@effect/vitest";
import { Effect, Ref } from "effect";
import { SqlClient } from "effect/sql";
import { Attendance } from "../../src/attendance/Attendance.ts";
import { Invitations } from "../../src/attendance/Invitations.ts";
import { EventContent } from "../../src/events/ContentTypes.ts";
import { Documents } from "../../src/events/Documents.ts";
import type { DocumentId } from "../../src/Model.ts";
import { AnnouncementsKept } from "../../src/notices/Announcements.ts";
import { NoticesKept } from "../../src/notices/Notifications.ts";
import {
  alice,
  bob,
  emailKinds,
  fillEveryKindOfField,
  newTeam,
  openEditor,
  publishedEvent,
  setEmailField,
  setEmailRichText,
  setLimit,
  setQuestions,
  setTimes,
  TestLayer,
} from "../helpers.ts";

/** Every optional field `fillEveryKindOfField` leaves out, and the rest of the emails. */
const fillTheRest = (event: EventContent) => {
  setTimes(event, {
    deadline: "2036-10-15T12:00+02:00[Europe/Oslo]",
    foodDeadline: "2036-10-14T12:00+02:00[Europe/Oslo]",
  });
  const draft = event as Record<string, unknown>;
  draft.dietary = true;
  draft.food = "Pizza from Lorem";
  draft.hidePlacesLeft = true;
  draft.reminders = new A.ImmutableString("on");
  draft.recurring = true;
  draft.repeatEvery = 2;
  draft.repeatUnit = new A.ImmutableString("month");
  setLimit(event, 30);
  setEmailField(event, "signedUpSubject", "You are in");
  for (const kind of emailKinds.filter((kind) => kind !== "signedUp")) {
    setEmailField(event, `${kind}Subject`, `About ${kind}`);
    setEmailRichText(event, `${kind}Text`);
  }
};

/** What the database accepts: question and option ids are UUIDs. */
const storedQuestions = (event: EventContent) =>
  setQuestions(event, [
    {
      id: crypto.randomUUID(),
      type: "choice",
      text: "Which day?",
      options: [
        { id: crypto.randomUUID(), text: "Monday" },
        { id: crypto.randomUUID(), text: "Tuesday" },
      ],
    },
  ]);

const everything = (event: EventContent) => {
  fillEveryKindOfField(event);
  storedQuestions(event);
  fillTheRest(event);
};

const richTexts = [
  "body",
  "signedUpText",
  "signupCancelledText",
  "eventChangedText",
  "eventCancelledText",
];

/** Whether two drafts hold the same content, rich texts by their spans. */
const sameContentAs = (
  copy: A.Doc<EventContent>,
  source: A.Doc<EventContent>,
) =>
  isDeepStrictEqual(A.toJS(copy), A.toJS(source)) &&
  richTexts.every((key) =>
    isDeepStrictEqual(A.spans(copy, [key]), A.spans(source, [key])),
  );

const draftOf = (id: DocumentId) =>
  Effect.gen(function* () {
    const documents = yield* Documents;
    return A.load<EventContent>((yield* documents.get(id)).draft);
  });

const rowsOf = (id: DocumentId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [document] = yield* sql<{ row: Record<string, unknown> }>`
      SELECT to_jsonb(d) - 'xid' AS row FROM documents d WHERE id = ${id}
    `;
    const [event] = yield* sql<{ row: Record<string, unknown> }>`
      SELECT to_jsonb(e) - 'xid' AS row FROM events e WHERE id = ${id}
    `;
    const attendees = yield* sql<{ row: Record<string, unknown> }>`
      SELECT to_jsonb(a) - 'xid' AS row FROM attendees a
      WHERE event_id = ${id} ORDER BY id
    `;
    const invitations = yield* (yield* Invitations).invitations(id);
    return {
      document: document?.row,
      event: event?.row,
      attendees: attendees.map((attendee) => attendee.row),
      invitations,
    };
  });

/** A published event with a member and a guest signed up and one invitation. */
const busyEvent = Effect.gen(function* () {
  const attendance = yield* Attendance;
  const id = yield* publishedEvent({
    public: true,
    guests: true,
    edit: everything,
  });
  // The event is streamed, so each says how they follow it.
  yield* attendance.attend(id, bob, { online: true });
  yield* attendance.attendAsGuest(
    id,
    { name: "Gina", email: "gina@example.org" },
    { online: false },
  );
  yield* (yield* Invitations).invite(id, {
    name: "Ivan",
    email: "ivan@example.org",
  });
  return id;
});

const newId = () => crypto.randomUUID() as DocumentId;

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Copying an event", (it) => {
  it.effect(
    "makes a new, unpublished event in the same team with every field of the content, text spans included (AC-2)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const sql = yield* SqlClient.SqlClient;
        const source = yield* publishedEvent({
          public: true,
          guests: true,
          edit: everything,
        });
        const sourceDraft = yield* draftOf(source);
        const present = A.toJS(sourceDraft) as Record<string, unknown>;
        for (const key of Object.keys(EventContent.fields)) {
          assert.isDefined(present[key], `the source has a value for ${key}`);
        }

        const id = newId();
        assert.strictEqual(yield* documents.copy(source, id, bob), id);

        const snapshot = yield* documents.get(id);
        assert.strictEqual(snapshot.type, "event");
        assert.strictEqual(
          snapshot.teamId,
          (yield* documents.get(source)).teamId,
        );
        assert.isTrue(
          sameContentAs(A.load<EventContent>(snapshot.draft), sourceDraft),
        );

        const [made] = yield* sql<{ issuer: string; subject: string }>`
          SELECT created_by_issuer AS issuer, created_by_subject AS subject
          FROM documents WHERE id = ${id}
        `;
        assert.strictEqual(made?.subject, bob.subject);
        const published = yield* sql`SELECT 1 FROM events WHERE id = ${id}`;
        assert.lengthOf(published, 0);
      }),
  );

  it.effect("copies an event that has never been published (AC-2)", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const sql = yield* SqlClient.SqlClient;
      const source = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(source);
      yield* documents.applyChanges(source, [editor.edit(everything)], alice);

      const id = newId();
      yield* documents.copy(source, id, alice);

      assert.strictEqual(
        (yield* documents.get(id)).teamId,
        (yield* documents.get(source)).teamId,
      );
      assert.isTrue(sameContentAs(yield* draftOf(id), yield* draftOf(source)));
      assert.lengthOf(yield* sql`SELECT 1 FROM events WHERE id = ${id}`, 0);
    }),
  );

  it.effect(
    "does nothing when the same copy is asked for again under the same id (AC-2)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const sql = yield* SqlClient.SqlClient;
        const source = yield* publishedEvent({ public: true, guests: false });
        const team = (yield* documents.get(source)).teamId;
        const id = newId();
        yield* documents.copy(source, id, alice);
        const first = yield* documents.get(id);

        assert.strictEqual(yield* documents.copy(source, id, alice), id);

        const second = yield* documents.get(id);
        assert.deepStrictEqual(second.heads, first.heads);
        const [count] = yield* sql<{ count: number }>`
          SELECT count(*)::int AS count FROM documents WHERE team_id = ${team}
        `;
        assert.strictEqual(count?.count, 2);
      }),
  );

  it.effect("fails for a deleted event and makes no document (AC-2)", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const sql = yield* SqlClient.SqlClient;
      const source = yield* publishedEvent({ public: true, guests: false });
      yield* documents.delete(source, alice);

      const id = newId();
      const error = yield* Effect.flip(documents.copy(source, id, alice));
      assert.strictEqual(error._tag, "DocumentNotFound");
      assert.lengthOf(yield* sql`SELECT 1 FROM documents WHERE id = ${id}`, 0);
    }),
  );

  it.effect(
    "gives the copy no attendees and no invitations, and tells nobody (AC-3)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const notices = yield* NoticesKept;
        const announcements = yield* AnnouncementsKept;
        const sql = yield* SqlClient.SqlClient;
        const source = yield* busyEvent;
        const noticesBefore = (yield* Ref.get(notices)).length;
        const announcedBefore = (yield* Ref.get(announcements)).length;

        const id = newId();
        yield* documents.copy(source, id, alice);

        const rows = yield* rowsOf(id);
        assert.deepStrictEqual(rows.attendees, []);
        assert.deepStrictEqual(rows.invitations, []);
        assert.lengthOf(
          yield* sql`SELECT 1 FROM attendees WHERE event_id = ${id}`,
          0,
        );
        assert.strictEqual((yield* Ref.get(notices)).length, noticesBefore);
        assert.strictEqual(
          (yield* Ref.get(announcements)).length,
          announcedBefore,
        );
      }),
  );

  it.effect("leaves the event that was copied as it was (AC-5)", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const source = yield* busyEvent;
      const before = yield* rowsOf(source);
      const headsBefore = (yield* documents.get(source)).heads;
      assert.isDefined(before.event);
      assert.lengthOf(before.attendees, 2);
      assert.lengthOf(before.invitations, 1);

      yield* documents.copy(source, newId(), alice);

      assert.deepStrictEqual(yield* rowsOf(source), before);
      assert.deepStrictEqual((yield* documents.get(source)).heads, headsBefore);
    }),
  );
});
