import * as A from "@automerge/automerge";
import { assert, layer } from "@effect/vitest";
import { Effect, Ref } from "effect";
import { SqlClient } from "effect/sql";
import { AnnouncementsKept } from "../../src/Announcements.ts";
import type { EventContent } from "../../src/ContentTypes.ts";
import { Documents } from "../../src/Documents.ts";
import type { DocumentId } from "../../src/Model.ts";
import {
  alice,
  bob,
  end,
  newTeam,
  openEditor,
  publishedAs,
  publishedEvent,
  setCover,
  setPlace,
  setQuestions,
  setTimes,
  start,
  syncedDocument,
  TestLayer,
} from "../helpers.ts";

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Documents", (it) => {
  it.effect("creates a document with the id a client picked, once", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const team = yield* newTeam;
      const id = crypto.randomUUID() as DocumentId;
      assert.strictEqual(yield* documents.create("event", team, alice, id), id);
      // A retry is fine, and doesn't reset the draft.
      const editor = yield* openEditor(id);
      yield* documents.applyChanges(
        id,
        [editor.edit((event) => A.updateText(event, ["title"], "Kept"))],
        alice,
      );
      assert.strictEqual(yield* documents.create("event", team, alice, id), id);
      const draft = A.load<EventContent>((yield* documents.get(id)).draft);
      assert.strictEqual(draft.title, "Kept");
    }),
  );

  it.effect(
    "tells Announcements once when an event is first published (AC-1)",
    () =>
      Effect.gen(function* () {
        const kept = yield* AnnouncementsKept;
        const id = yield* publishedEvent({ public: true, guests: true });
        const told = (yield* Ref.get(kept)).filter((event) => event === id);
        assert.deepStrictEqual(told, [id]);
      }),
  );

  it.effect(
    "tells Announcements nothing when a published event is published again (AC-2)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const kept = yield* AnnouncementsKept;
        const id = yield* publishedEvent({ public: true, guests: true });
        const editor = yield* openEditor(id);
        // A new title, then moved a day.
        const retitled = yield* documents.applyChanges(
          id,
          [editor.edit((event) => A.updateText(event, ["title"], "Meetup 2"))],
          alice,
        );
        yield* documents.publish(id, retitled, alice);
        const moved = yield* documents.applyChanges(
          id,
          [
            editor.edit((event) =>
              setTimes(event, {
                start: "2036-10-16T18:00+02:00[Europe/Oslo]",
                end: "2036-10-16T21:00+02:00[Europe/Oslo]",
              }),
            ),
          ],
          alice,
        );
        yield* documents.publish(id, moved, alice);
        const told = (yield* Ref.get(kept)).filter((event) => event === id);
        assert.deepStrictEqual(told, [id]);
      }),
  );

  it.effect("creates an empty draft", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const snapshot = yield* documents.get(id);
      assert.strictEqual(snapshot.type, "event");
      assert.deepStrictEqual(A.toJS(A.load(snapshot.draft)), {
        title: "",
        summary: "",
        body: "",
        start: null,
        end: null,
        deadline: null,
        public: false,
        guests: false,
        dietary: false,
        food: "",
        foodDeadline: null,
        questions: [],
        tags: [],
        reminders: true,
        place: "",
      });
      assert.deepStrictEqual(
        snapshot.heads,
        A.getHeads(A.load(snapshot.draft)),
      );
    }),
  );

  it.effect("merges edits from two users and syncs them", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const aliceEditor = yield* openEditor(id);
      const bobEditor = yield* openEditor(id);

      yield* documents.applyChanges(
        id,
        [aliceEditor.edit((event) => A.updateText(event, ["title"], "Hello"))],
        alice,
      );
      const heads = yield* documents.applyChanges(
        id,
        [bobEditor.edit((event) => A.updateText(event, ["body"], "World"))],
        bob,
      );

      // Each editor fetches only what it is missing.
      const forAlice = yield* documents.changesSince(
        id,
        A.getHeads(aliceEditor.doc()),
      );
      aliceEditor.receive(forAlice.changes);
      bobEditor.receive(
        (yield* documents.changesSince(id, A.getHeads(bobEditor.doc())))
          .changes,
      );
      assert.deepStrictEqual([...forAlice.heads].sort(), [...heads].sort());
      for (const editor of [aliceEditor, bobEditor]) {
        assert.deepStrictEqual(A.toJS(editor.doc()), {
          title: "Hello",
          summary: "",
          body: "World",
          start: null,
          end: null,
          deadline: null,
          public: false,
          guests: false,
          dietary: false,
          food: "",
          foodDeadline: null,
          questions: [],
          tags: [],
          reminders: true,
          place: "",
        });
        assert.deepStrictEqual(
          [...A.getHeads(editor.doc())].sort(),
          [...heads].sort(),
        );
      }
    }),
  );

  it.effect("accepts re-sent changes as a no-op", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id);
      const change = editor.edit((event) =>
        A.updateText(event, ["title"], "Once"),
      );
      const first = yield* documents.applyChanges(id, [change], alice);
      const again = yield* documents.applyChanges(id, [change], alice);
      assert.deepStrictEqual(again, first);
    }),
  );

  it.effect("only accepts changes from the sender's own actor ids", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const aliceEditor = yield* openEditor(id);
      yield* documents.applyChanges(
        id,
        [aliceEditor.edit((event) => A.updateText(event, ["title"], "Mine"))],
        alice,
      );

      // Alice's actor id is hers now: Bob can't make changes under it.
      let forged = A.load<EventContent>(
        A.save(aliceEditor.doc()),
        A.getActorId(aliceEditor.doc()),
      );
      forged = A.change(forged, (event) =>
        A.updateText(event, ["title"], "Not yours"),
      );
      const change = A.getLastLocalChange(forged);
      if (change === undefined) throw new Error("no change");
      const sent = yield* Effect.flip(
        documents.applyChanges(id, [change], bob),
      );
      assert.strictEqual(sent._tag, "ActorNotAllowed");

      // Alice's next session has a new actor id, and can send too.
      const nextSession = yield* openEditor(id);
      yield* documents.applyChanges(
        id,
        [nextSession.edit((event) => A.updateText(event, ["title"], "Still"))],
        alice,
      );
    }),
  );

  it.effect("rejects changes that don't fit the content type", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id);
      const before = (yield* documents.get(id)).heads;

      const extraField = yield* Effect.flip(
        documents.applyChanges(
          id,
          [editor.edit((event) => Object.assign(event, { secret: "x" }))],
          alice,
        ),
      );
      assert.strictEqual(extraField._tag, "InvalidContent");

      // The rejected change stays in that replica, so later changes build on
      // it; a rejected editor has to reload. Use a fresh one.
      const fresh = yield* openEditor(id);
      const wrongType = yield* Effect.flip(
        documents.applyChanges(
          id,
          [fresh.edit((event) => Object.assign(event, { title: 42 }))],
          alice,
        ),
      );
      assert.strictEqual(wrongType._tag, "InvalidContent");

      assert.deepStrictEqual((yield* documents.get(id)).heads, before);
    }),
  );

  it.effect("only accepts times that exist, in their time zone", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      for (const time of [
        "2036-10-15",
        "2036-10-15T18:00",
        "2036-10-15T18:00+02:00",
        "2036-02-30T18:00+01:00[Europe/Oslo]",
        // Oslo is +01:00 in winter.
        "2036-01-15T18:00+02:00[Europe/Oslo]",
        "2036-10-15T18:00+02:00[Europe/Atlantis]",
      ]) {
        const editor = yield* openEditor(id);
        const error = yield* Effect.flip(
          documents.applyChanges(
            id,
            [editor.edit((event) => setTimes(event, { start: time }))],
            alice,
          ),
        );
        assert.strictEqual(error._tag, "InvalidContent", time);
      }
      const editor = yield* openEditor(id);
      yield* documents.applyChanges(
        id,
        [
          editor.edit((event) =>
            setTimes(event, {
              start: "2036-01-15T18:00:30+01:00[Europe/Oslo]",
              deadline: "2036-01-15T12:00-05:00[America/New_York]",
            }),
          ),
        ],
        alice,
      );
    }),
  );

  it.effect("rejects changes whose dependencies it hasn't seen", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id);
      editor.edit((event) => A.updateText(event, ["title"], "First"));
      const second = editor.edit((event) =>
        A.updateText(event, ["title"], "Second"),
      );
      const error = yield* Effect.flip(
        documents.applyChanges(id, [second], alice),
      );
      assert.strictEqual(error._tag, "InvalidChanges");
    }),
  );

  it.effect("publishes the cover image, which has to be an uploaded one", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const sql = yield* SqlClient.SqlClient;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const src = "/api/images/AAAAAAAAAAAAAAAAAAAAAA";

      const elsewhere = yield* openEditor(id);
      const error = yield* Effect.flip(
        documents.applyChanges(
          id,
          [
            elsewhere.edit((event) => {
              setCover(event, "https://example.com/x.png");
            }),
          ],
          alice,
        ),
      );
      assert.strictEqual(error._tag, "InvalidContent");

      const editor = yield* openEditor(id);
      const withCover = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) => {
            A.updateText(event, ["title"], "Launch");
            setTimes(event);
            setPlace(event);
            setCover(event, src);
          }),
          editor.edit((event) =>
            A.updateText(event, ["cover", "alt"], "A full room"),
          ),
        ],
        alice,
      );
      yield* documents.publish(id, withCover, alice);
      const cover = sql<{ cover: unknown }>`
        SELECT cover FROM events WHERE id = ${id}
      `;
      assert.deepStrictEqual(yield* cover, [
        { cover: { src, alt: "A full room" } },
      ]);

      // Taken off again.
      const without = yield* documents.applyChanges(
        id,
        [editor.edit((event) => setCover(event, null))],
        alice,
      );
      yield* documents.publish(id, without, alice);
      assert.deepStrictEqual(yield* cover, [{ cover: null }]);
    }),
  );

  it.effect("publishes the version the user saw", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const sql = yield* SqlClient.SqlClient;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id);

      const seen = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) => {
            A.updateText(event, ["title"], "Launch");
            // A heading, and a paragraph with a bold word.
            A.splitBlock(event, ["body"], 0, {
              type: new A.ImmutableString("heading"),
              parents: [],
              attrs: { level: 2 },
            });
            A.splice(event, ["body"], 1, 0, "News");
            A.splitBlock(event, ["body"], 5, {
              type: new A.ImmutableString("paragraph"),
              parents: [],
              attrs: {},
            });
            A.splice(event, ["body"], 6, 0, "We're live");
            A.mark(
              event,
              ["body"],
              { start: 12, end: 16, expand: "none" },
              "strong",
              true,
            );
            setTimes(event);
            setPlace(event);
          }),
        ],
        alice,
      );
      // Someone keeps typing while Alice clicks publish.
      yield* documents.applyChanges(
        id,
        [editor.edit((event) => A.updateText(event, ["title"], "Launch day!"))],
        alice,
      );

      const first = yield* documents.publish(id, seen, alice);
      assert.deepStrictEqual(first.heads, seen);
      const [row] = yield* sql<{
        title: string;
        body: unknown;
        starts_at: Date;
        ends_at: Date;
        signup_deadline: Date | null;
        time_zone: string;
      }>`
        SELECT title, body, starts_at, ends_at, signup_deadline, time_zone
        FROM events WHERE id = ${id}
      `;
      // The body keeps its structure.
      assert.deepStrictEqual(row, {
        title: "Launch",
        body: [
          {
            type: "block",
            value: { type: "heading", attrs: { level: 2 }, parents: [] },
          },
          { type: "text", value: "News" },
          {
            type: "block",
            value: { type: "paragraph", attrs: {}, parents: [] },
          },
          { type: "text", value: "We're " },
          { type: "text", value: "live", marks: { strong: true } },
        ],
        starts_at: new Date("2036-10-15T16:00:00Z"),
        ends_at: new Date("2036-10-15T19:00:00Z"),
        signup_deadline: null,
        time_zone: "Europe/Oslo",
      });

      const latest = (yield* documents.get(id)).heads;
      const second = yield* documents.publish(id, latest, alice);
      assert.deepStrictEqual(second.firstPublishedAt, first.firstPublishedAt);
      assert.isTrue(second.publishedAt >= first.publishedAt);
      const [updated] = yield* sql<{ title: string }>`
        SELECT title FROM events WHERE id = ${id}
      `;
      assert.strictEqual(updated?.title, "Launch day!");
    }),
  );

  it.effect(
    "refuses to publish without a title, times or a place, or an unknown version (AC-2)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const id = yield* documents.create("event", yield* newTeam, alice);
        const editor = yield* openEditor(id);
        const blank = (yield* documents.get(id)).heads;
        const dated = yield* documents.applyChanges(
          id,
          [
            editor.edit((event) => {
              setTimes(event);
              setPlace(event);
            }),
          ],
          alice,
        );
        const empty = yield* Effect.flip(documents.publish(id, blank, alice));
        assert.strictEqual(
          empty.message,
          "Add a title, a start time, an end time and a place before publishing",
        );
        const untitled = yield* Effect.flip(
          documents.publish(id, dated, alice),
        );
        assert.strictEqual(untitled.message, "Add a title before publishing");

        // A place of nothing but spaces is no place.
        for (const place of ["", "  "]) {
          const placeless = yield* documents.applyChanges(
            id,
            [
              editor.edit((event) => {
                A.updateText(event, ["title"], "Endless");
                setPlace(event, place);
              }),
            ],
            alice,
          );
          const unplaced = yield* Effect.flip(
            documents.publish(id, placeless, alice),
          );
          assert.strictEqual(unplaced.message, "Add a place before publishing");
        }

        const titled = yield* documents.applyChanges(
          id,
          [
            editor.edit((event) => {
              setPlace(event);
              setTimes(event, { end: null });
            }),
          ],
          alice,
        );
        const undated = yield* Effect.flip(
          documents.publish(id, titled, alice),
        );
        assert.strictEqual(
          undated.message,
          "Add an end time before publishing",
        );

        // The times have to make sense together.
        for (const [times, message] of [
          [{ end: start }, "The event has to end after it starts"],
          [
            { end, deadline: "2036-10-15T18:01+02:00[Europe/Oslo]" },
            "The sign-up deadline can't be after the event starts",
          ],
          [
            { end: "2036-10-15T20:00+01:00[Europe/London]", deadline: null },
            "The times have to be in the same time zone",
          ],
        ] as const) {
          const heads = yield* documents.applyChanges(
            id,
            [editor.edit((event) => setTimes(event, times))],
            alice,
          );
          const refused = yield* Effect.flip(
            documents.publish(id, heads, alice),
          );
          assert.strictEqual(refused.message, message);
        }

        const unknown = yield* Effect.flip(
          documents.publish(id, ["00".repeat(32)], alice),
        );
        assert.strictEqual(unknown._tag, "PublishRejected");
      }),
  );

  it.effect("syncs what lists show, in step with the draft", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const team = yield* newTeam;
      const id = yield* documents.create("event", team, alice);
      const editor = yield* openEditor(id);
      const find = syncedDocument(id);
      // Nothing unpublished: the draft is the version published.
      const unpublished = Effect.gen(function* () {
        const draft = yield* find;
        const published = yield* publishedAs(id, "members");
        return draft?.draftHeads.join() !== published?.publishedHeads.join();
      });

      const draft = yield* find;
      assert.deepStrictEqual(
        [draft?.title, draft?.startsAt, draft?.timeZone],
        ["", null, null],
      );
      assert.deepStrictEqual(draft?.draftHeads, [...A.getHeads(editor.doc())]);
      assert.isUndefined(yield* publishedAs(id, "members"));
      assert.isTrue(yield* unpublished);

      const heads = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) => {
            A.updateText(event, ["title"], "Listed");
            setTimes(event);
            setPlace(event);
          }),
        ],
        alice,
      );
      const publication = yield* documents.publish(id, heads, alice);
      const published = yield* find;
      assert.deepStrictEqual(
        [published?.title, published?.startsAt, published?.timeZone],
        ["Listed", new Date("2036-10-15T16:00:00Z"), "Europe/Oslo"],
      );
      assert.isFalse(yield* unpublished);
      assert.deepStrictEqual(
        (yield* publishedAs(id, "members"))?.publishedHeads,
        publication.heads,
      );

      yield* documents.applyChanges(
        id,
        [
          editor.edit((event) =>
            A.updateText(event, ["title"], "Listed again"),
          ),
        ],
        alice,
      );
      assert.strictEqual((yield* find)?.title, "Listed again");
      assert.isTrue(yield* unpublished);
    }),
  );

  it.effect("shows the public only what was published", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id);
      const heads = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) => {
            A.updateText(event, ["title"], "Public");
            setTimes(event);
            setPlace(event);
          }),
        ],
        alice,
      );

      // A draft is invisible until it is published.
      assert.isUndefined(yield* publishedAs(id, "members"));

      yield* documents.publish(id, heads, alice);
      yield* documents.applyChanges(
        id,
        [
          editor.edit((event) =>
            A.updateText(event, ["title"], "Secret draft"),
          ),
        ],
        alice,
      );

      // Edits after publishing stay private until republished.
      assert.strictEqual((yield* publishedAs(id, "members"))?.title, "Public");
    }),
  );

  it.effect("deletes a document and its published version", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id);
      const heads = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) => {
            A.updateText(event, ["title"], "Short-lived");
            setTimes(event);
            setPlace(event);
          }),
        ],
        alice,
      );
      yield* documents.publish(id, heads, alice);

      yield* documents.delete(id, alice);
      assert.strictEqual(
        (yield* Effect.flip(documents.get(id)))._tag,
        "DocumentNotFound",
      );
      assert.isUndefined(yield* publishedAs(id, "members"));
      assert.strictEqual(
        (yield* Effect.flip(documents.delete(id, alice)))._tag,
        "DocumentNotFound",
      );
    }),
  );

  it.effect(
    "refuses to publish half-made questions or a late food deadline",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const id = yield* documents.create("event", yield* newTeam, alice);
        const editor = yield* openEditor(id);
        const refusal = (edit: (event: EventContent) => void) =>
          Effect.gen(function* () {
            const heads = yield* documents.applyChanges(
              id,
              [editor.edit(edit)],
              alice,
            );
            const error = yield* Effect.flip(
              documents.publish(id, heads, alice),
            );
            return error.message;
          });
        yield* documents.applyChanges(
          id,
          [
            editor.edit((event) => {
              A.updateText(event, ["title"], "Questions");
              setTimes(event);
              setPlace(event);
            }),
          ],
          alice,
        );
        const option = () => ({ id: crypto.randomUUID(), text: "Yes" });
        const question = {
          id: crypto.randomUUID(),
          type: "choice",
          text: "Coming by bike?",
        } as const;

        assert.strictEqual(
          yield* refusal((event) =>
            setQuestions(event, [{ ...question, type: "text", text: " " }]),
          ),
          "Every question needs its text",
        );
        assert.strictEqual(
          yield* refusal((event) =>
            setQuestions(event, [{ ...question, options: [option()] }]),
          ),
          "Choice questions need at least two options, all filled in",
        );
        assert.strictEqual(
          yield* refusal((event) =>
            setQuestions(event, [
              { ...question, options: [option(), { ...option(), text: "" }] },
            ]),
          ),
          "Choice questions need at least two options, all filled in",
        );
        assert.strictEqual(
          yield* refusal((event) => {
            setQuestions(event, []);
            setTimes(event, {
              deadline: "2036-10-14T12:00+02:00[Europe/Oslo]",
              foodDeadline: "2036-10-14T12:01+02:00[Europe/Oslo]",
            });
          }),
          "The food deadline can't be after sign-up closes",
        );
      }),
  );
});
