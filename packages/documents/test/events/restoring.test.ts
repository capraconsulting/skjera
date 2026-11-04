import * as A from "@automerge/automerge";
import { assert, layer } from "@effect/vitest";
import { Identity } from "@skjera/oauth/api";
import { Effect, Ref } from "effect";
import { SqlClient } from "effect/sql";
import { Attendance } from "../../src/attendance/Attendance.ts";
import type { EventContent } from "../../src/events/ContentTypes.ts";
import { sameContent } from "../../src/events/DiscardChanges.ts";
import { Documents } from "../../src/events/Documents.ts";
import type { DocumentId } from "../../src/Model.ts";
import { AnnouncementsKept } from "../../src/notices/Announcements.ts";
import { NoticesKept } from "../../src/notices/Notifications.ts";
import {
  addTags,
  alice,
  bob,
  fillEveryKindOfField,
  image,
  newTeam,
  openEditor,
  paragraph,
  setCover,
  setLimit,
  setPlace,
  setQuestions,
  setSummary,
  setTimes,
  TestLayer,
  text,
  writeBody,
} from "../helpers.ts";

// Restoring an earlier version of a draft, on a real database.

const restorer = new Identity({
  issuer: "https://idp.example",
  subject: `restorer-${crypto.randomUUID()}`,
  name: "Rita Restorer",
});

const draftOf = (id: DocumentId) =>
  Effect.gen(function* () {
    const snapshot = yield* (yield* Documents).get(id);
    return A.load<EventContent>(snapshot.draft);
  });

/** An event with a value of every kind of field, published; its version. */
const publishedEveryKind = Effect.gen(function* () {
  const documents = yield* Documents;
  const id = yield* documents.create("event", yield* newTeam, alice);
  const editor = yield* openEditor(id);
  const heads = yield* documents.applyChanges(
    id,
    [
      editor.edit((event) => {
        fillEveryKindOfField(event);
        // The server checks the ids.
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
        setCover(event, "/api/images/AAAAAAAAAAAAAAAAAAAAAA", {
          crop: {
            x: 0.1,
            y: 0.1,
            width: 0.5,
            height: 0.5,
            from: "/api/images/AAAAAAAAAAAAAAAAAAAAAA",
            src: "/api/images/CCCCCCCCCCCCCCCCCCCCCC",
          },
          focus: { x: 0.3, y: 0.4 },
        });
        (event as { public: boolean }).public = true;
        (event as { guests: boolean }).guests = true;
      }),
    ],
    alice,
  );
  const publication = yield* documents.publish(id, heads, alice);
  return { id, version: publication.heads, editor };
});

/** Changes every kind of field the version had. */
const changeEverything = (event: EventContent) => {
  A.updateText(event, ["title"], "Launch day");
  setSummary(event, "Another summary");
  writeBody(event, [
    paragraph(),
    text("Read first"),
    image("A dog", "Short", "small"),
  ]);
  setCover(event, "/api/images/BBBBBBBBBBBBBBBBBBBBBB", {
    focus: { x: 0.9, y: 0.9 },
  });
  setTimes(event, {
    start: "2036-10-16T18:00+02:00[Europe/Oslo]",
    end: "2036-10-16T21:00+02:00[Europe/Oslo]",
  });
  setPlace(event, "Aula");
  addTags(event, "extra");
  setQuestions(event, [
    { id: crypto.randomUUID(), type: "text", text: "Anything else?" },
  ]);
  setLimit(event, 20);
};

const eventRow = (id: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ row: Record<string, unknown> }>`
      SELECT to_jsonb(e) - 'xid' AS row FROM events e WHERE id = ${id}
    `;
    return row?.row;
  });

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Restoring a version", (it) => {
  it.effect(
    "makes the draft equal to the version in every field and leaves the published event as it was (AC-3)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const { id, version, editor } = yield* publishedEveryKind;
        yield* documents.applyChanges(
          id,
          [editor.edit(changeEverything)],
          alice,
        );
        const rowBefore = yield* eventRow(id);
        const changed = yield* draftOf(id);
        assert.isFalse(sameContent(changed, [...version]));

        yield* documents.restore(id, version, restorer);

        const restored = yield* draftOf(id);
        assert.isTrue(sameContent(restored, [...version]));
        assert.strictEqual(restored.title, "Launch");
        assert.deepStrictEqual(yield* eventRow(id), rowBefore);
      }),
  );

  it.effect(
    "refuses heads the draft does not have and strings that are not change hashes, and changes nothing (AC-3)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const { id } = yield* publishedEveryKind;
        const before = yield* documents.get(id);
        for (const heads of [
          ["f".repeat(64)],
          ["not a hash"],
          [],
          ["A".repeat(64)],
        ]) {
          const error = yield* Effect.flip(
            documents.restore(id, heads, restorer),
          );
          assert.strictEqual(error._tag, "RestoreRejected");
          assert.deepStrictEqual("problem" in error ? error.problem : null, {
            _tag: "UnknownVersion",
          });
        }
        const after = yield* documents.get(id);
        assert.deepStrictEqual(after.heads, before.heads);
      }),
  );

  it.effect("fails for a document that does not exist (AC-3)", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const error = yield* Effect.flip(
        documents.restore(
          "00000000-0000-7000-8000-000000000000" as DocumentId,
          ["a".repeat(64)],
          restorer,
        ),
      );
      assert.strictEqual(error._tag, "DocumentNotFound");
    }),
  );

  it.effect(
    "sends no email and announces nothing, and keeps the signups (AC-4)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const attendance = yield* Attendance;
        const notices = yield* NoticesKept;
        const announcements = yield* AnnouncementsKept;
        const sql = yield* SqlClient.SqlClient;
        const { id, version, editor } = yield* publishedEveryKind;
        yield* attendance.attend(id, bob, { online: false });
        yield* attendance.attendAsGuest(
          id,
          { name: "Gina", email: "gina@example.org" },
          { online: false },
        );
        yield* documents.applyChanges(
          id,
          [editor.edit(changeEverything)],
          alice,
        );
        const kept = (all: ReadonlyArray<{ readonly event: string }>) =>
          all.filter((item) => item.event === id).length;
        const noticesBefore = kept(yield* Ref.get(notices));
        const announcedBefore = (yield* Ref.get(announcements)).filter(
          (event) => event === id,
        ).length;

        yield* documents.restore(id, version, restorer);

        assert.strictEqual(kept(yield* Ref.get(notices)), noticesBefore);
        assert.strictEqual(
          (yield* Ref.get(announcements)).filter((event) => event === id)
            .length,
          announcedBefore,
        );
        const [signed] = yield* sql<{ count: number }>`
          SELECT count(*)::int AS count FROM attendees WHERE event_id = ${id}
        `;
        assert.strictEqual(signed?.count, 2);
      }),
  );

  it.effect(
    "shows the restoring as the newest entry, and restoring the entry before it undoes it (AC-7)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const { id, version, editor } = yield* publishedEveryKind;
        yield* documents.applyChanges(
          id,
          [editor.edit(changeEverything)],
          alice,
        );
        const beforeRestore = yield* draftOf(id);
        const beforeHeads = [...A.getHeads(beforeRestore)];

        yield* documents.restore(id, version, restorer);

        const [newest, previous] = yield* documents.history(id);
        assert.strictEqual(newest?.kind, "restored");
        assert.strictEqual(newest?.by, "Rita Restorer");
        assert.deepStrictEqual([...(previous?.heads ?? [])], beforeHeads);

        yield* documents.restore(id, previous?.heads ?? [], restorer);

        const undone = yield* draftOf(id);
        assert.deepStrictEqual(A.toJS(undone), A.toJS(beforeRestore));
        assert.strictEqual((yield* documents.history(id))[0]?.kind, "restored");
      }),
  );

  it.effect(
    "gives a version with the draft's own content a restoring entry too (AC-7)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const { id } = yield* publishedEveryKind;
        const before = yield* documents.history(id);
        const current = (yield* documents.get(id)).heads;

        yield* documents.restore(id, current, restorer);

        const after = yield* documents.history(id);
        assert.strictEqual(after.length, before.length + 1);
        assert.strictEqual(after[0]?.kind, "restored");
        assert.strictEqual(after[0]?.by, "Rita Restorer");
        assert.isTrue(sameContent(yield* draftOf(id), [...current]));
      }),
  );
});
