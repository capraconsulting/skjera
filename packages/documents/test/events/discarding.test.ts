import { isDeepStrictEqual } from "node:util";
import * as A from "@automerge/automerge";
import { assert, describe, it, layer } from "@effect/vitest";
import { Identity } from "@skjera/oauth/api";
import { Effect, Ref } from "effect";
import { SqlClient } from "effect/sql";
import { Attendance } from "../../src/attendance/Attendance.ts";
import {
  contentTypes,
  type EventContent,
} from "../../src/events/ContentTypes.ts";
import {
  restorePublished,
  sameContent,
} from "../../src/events/DiscardChanges.ts";
import { Documents } from "../../src/events/Documents.ts";
import { AnnouncementsKept } from "../../src/notices/Announcements.ts";
import { NoticesKept } from "../../src/notices/Notifications.ts";
import {
  addTags,
  alice,
  bob,
  fillEveryKindOfField,
  image,
  link,
  newTeam,
  openEditor,
  paragraph,
  publishedEvent,
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

const newDraft = () =>
  A.from<EventContent>({ ...contentTypes.event.initial } as EventContent);

/** The draft as it is published, with a value of every kind the schema has. */
const published = () => A.change(newDraft(), fillEveryKindOfField);

/** The same draft after an organiser has changed every kind of field. */
const edited = (doc: A.Doc<EventContent>) =>
  A.change(doc, (event) => {
    A.updateText(event, ["title"], "Launch day");
    setSummary(event, "Another summary");
    writeBody(event, [
      paragraph(),
      text("Read "),
      text("the docs"),
      text(" first, then be bold"),
      image("A dog", "Short", "small"),
      paragraph(),
      text("One more paragraph"),
    ]);
    A.splice(event, ["signedUpText"], 1, 0, "Extra ");
    setCover(event, "/api/images/BBBBBBBBBBBBBBBBBBBBBB");
    A.updateText(event, ["cover", "alt"], "Another room");
    setTimes(event, {
      start: "2036-10-16T18:00+02:00[Europe/Oslo]",
      end: "2036-10-16T21:00+02:00[Europe/Oslo]",
    });
    setPlace(event, "Aula");
    addTags(event, "extra");
    setQuestions(event, [{ id: "q2", type: "text", text: "Anything else?" }]);
    setLimit(event, 20);
    delete (event as { streamLink?: string }).streamLink;
    (event as { streamed?: boolean }).streamed = false;
  });

const spansOf = (doc: A.Doc<EventContent>, key: string) => A.spans(doc, [key]);

describe("restorePublished", () => {
  it("puts every kind of field back as published, text and images included (AC-4)", () => {
    const first = published();
    const heads = A.getHeads(first);
    const changed = edited(first);
    assert.isFalse(sameContent(changed, heads));

    const restored = restorePublished(changed, heads);
    assert.isTrue(sameContent(restored, heads));

    const before = A.clone(A.view(restored, heads));
    assert.isTrue(isDeepStrictEqual(A.toJS(restored), A.toJS(before)));
    for (const key of ["body", "signedUpText"]) {
      assert.isTrue(
        isDeepStrictEqual(spansOf(restored, key), spansOf(before, key)),
        `${key} is back as published`,
      );
    }
  });

  it("does not let new text join a restored link (AC-4)", () => {
    const first = A.change(newDraft(), (event) =>
      writeBody(event, [
        paragraph(),
        text("See "),
        text("the docs", { link }),
        text(" end"),
      ]),
    );
    const heads = A.getHeads(first);
    // The link taken off, so restoring has to put it back.
    const unlinked = A.change(first, (event) =>
      A.unmark(event, ["body"], { start: 5, end: 13, expand: "none" }, "link"),
    );

    const restored = restorePublished(unlinked, heads);
    // Right at the end of the link.
    const typed = A.change(restored, (event) =>
      A.splice(event, ["body"], 13, 0, "X"),
    );
    const typedSpan = A.spans(typed, ["body"]).find(
      (span) => span.type === "text" && span.value.includes("X"),
    );
    assert.isDefined(typedSpan);
    assert.notProperty((typedSpan as { marks?: object }).marks ?? {}, "link");
  });

  it("replaces an image that was changed rather than editing it, so no characters are removed from its attributes (AC-4)", () => {
    const first = A.change(newDraft(), (event) =>
      writeBody(event, [paragraph(), text("Look"), image("A cat", "Caption")]),
    );
    const heads = A.getHeads(first);
    const changed = A.change(first, (event) =>
      writeBody(event, [paragraph(), text("Look"), image("A dog", "Cap")]),
    );

    const restored = restorePublished(changed, heads);
    assert.isTrue(
      isDeepStrictEqual(spansOf(restored, "body"), spansOf(first, "body")),
    );
    const patches = A.diff(restored, A.getHeads(changed), A.getHeads(restored));
    const removedFromAttributes = patches.filter(
      (patch) => patch.action === "del" && patch.path.includes("attrs"),
    );
    assert.deepStrictEqual(removedFromAttributes, []);
  });
});

const rowOf = (id: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ row: Record<string, unknown> }>`
      SELECT to_jsonb(e) - 'xid' - 'published_heads' - 'published_at' AS row
      FROM events e WHERE id = ${id}
    `;
    return row?.row;
  });

const publishedHeadsOf = (id: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ heads: ReadonlyArray<string> }>`
      SELECT published_heads AS heads FROM events WHERE id = ${id}
    `;
    return row?.heads;
  });

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Discarding changes", (it) => {
  it.effect(
    "makes the draft the published version again and publishes it at the new heads (AC-4)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const id = yield* publishedEvent({ public: true, guests: true });
        const oldHeads = yield* publishedHeadsOf(id);
        const rowBefore = yield* rowOf(id);
        assert.isDefined(oldHeads);

        const editor = yield* openEditor(id);
        yield* documents.applyChanges(
          id,
          [
            editor.edit((event) => {
              A.updateText(event, ["title"], "Meetup, changed");
              setPlace(event, "Aula");
              addTags(event, "extra");
            }),
          ],
          alice,
        );

        yield* documents.discardChanges(id, alice);

        const snapshot = yield* documents.get(id);
        const draft = A.load<EventContent>(snapshot.draft);
        assert.isTrue(sameContent(draft, [...(oldHeads ?? [])]));
        assert.strictEqual(draft.title, "Meetup");
        assert.deepStrictEqual(yield* rowOf(id), rowBefore);
        assert.deepStrictEqual(
          yield* publishedHeadsOf(id),
          [...A.getHeads(draft)].sort(),
        );
      }),
  );

  it.effect(
    "does nothing for an event never published or unpublished (AC-4)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const sql = yield* SqlClient.SqlClient;

        const unpublished = yield* documents.create(
          "event",
          yield* newTeam,
          alice,
        );
        const editor = yield* openEditor(unpublished);
        yield* documents.applyChanges(
          unpublished,
          [editor.edit((event) => A.updateText(event, ["title"], "Draft"))],
          alice,
        );
        const draftBefore = yield* documents.get(unpublished);
        yield* documents.discardChanges(unpublished, alice);
        const draftAfter = yield* documents.get(unpublished);
        assert.deepStrictEqual(draftAfter.heads, draftBefore.heads);
        assert.isUndefined(yield* rowOf(unpublished));

        const taken = yield* publishedEvent({ public: true, guests: false });
        yield* documents.unpublish(taken);
        const takenEditor = yield* openEditor(taken);
        yield* documents.applyChanges(
          taken,
          [takenEditor.edit((event) => A.updateText(event, ["title"], "New"))],
          alice,
        );
        const rowBefore = yield* sql`
          SELECT to_jsonb(e) - 'xid' AS row FROM events e WHERE id = ${taken}
        `;
        const takenBefore = yield* documents.get(taken);
        yield* documents.discardChanges(taken, alice);
        const rowAfter = yield* sql`
          SELECT to_jsonb(e) - 'xid' AS row FROM events e WHERE id = ${taken}
        `;
        const takenAfter = yield* documents.get(taken);
        assert.deepStrictEqual(rowAfter, rowBefore);
        assert.deepStrictEqual(takenAfter.heads, takenBefore.heads);
      }),
  );

  it.effect(
    "tells nobody and keeps the signups, also when the draft had moved (AC-5)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const attendance = yield* Attendance;
        const notices = yield* NoticesKept;
        const announcements = yield* AnnouncementsKept;
        const sql = yield* SqlClient.SqlClient;
        const id = yield* publishedEvent({ public: true, guests: true });
        yield* attendance.attend(id, bob);
        yield* attendance.attendAsGuest(id, {
          name: "Gina",
          email: "gina@example.org",
        });
        const kept = (all: ReadonlyArray<{ readonly event: string }>) =>
          all.filter((item) => item.event === id).length;
        const noticesBefore = kept(yield* Ref.get(notices));
        const announcedBefore = (yield* Ref.get(announcements)).filter(
          (event) => event === id,
        ).length;

        const editor = yield* openEditor(id);
        yield* documents.applyChanges(
          id,
          [
            editor.edit((event) => {
              setTimes(event, {
                start: "2036-10-16T18:00+02:00[Europe/Oslo]",
                end: "2036-10-16T21:00+02:00[Europe/Oslo]",
              });
              setPlace(event, "Aula");
            }),
          ],
          alice,
        );

        yield* documents.discardChanges(id, alice);

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
    "names who discarded, as an entry of its own in the history (AC-1)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const discarder = new Identity({
          issuer: "https://idp.example",
          subject: `discarder-${crypto.randomUUID()}`,
          name: "Dina Discarder",
        });
        const id = yield* publishedEvent({ public: true, guests: true });
        const editor = yield* openEditor(id);
        yield* documents.applyChanges(
          id,
          [editor.edit((event) => A.updateText(event, ["title"], "Changed"))],
          alice,
        );

        yield* documents.discardChanges(id, discarder);

        const [newest, edited] = yield* documents.history(id);
        assert.strictEqual(newest?.kind, "discarded");
        assert.strictEqual(newest?.by, "Dina Discarder");
        assert.isFalse(newest?.automatic);
        assert.strictEqual(edited?.kind, "edited");
      }),
  );

  it.effect("adds no entry for a discard that changes nothing (AC-1)", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* publishedEvent({ public: true, guests: true });
      const before = yield* documents.history(id);

      yield* documents.discardChanges(id, alice);

      assert.strictEqual((yield* documents.history(id)).length, before.length);
    }),
  );
});
