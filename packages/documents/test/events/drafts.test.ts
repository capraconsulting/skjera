import * as A from "@automerge/automerge";
import { assert, layer } from "@effect/vitest";
import { Effect } from "effect";
import type { EventContent } from "../../src/events/ContentTypes.ts";
import { Documents } from "../../src/events/documents/index.ts";
import type { DocumentId } from "../../src/Model.ts";
import {
  addTags,
  alice,
  bob,
  interruptedWhileLocked,
  newTeam,
  openEditor,
  publishedAs,
  publishedEvent,
  setPlace,
  setTimes,
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

  it.effect("syncs what lists show, in step with the draft (AC-1, AC-7)", () =>
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
      assert.deepStrictEqual(draft?.tags, []);
      assert.isUndefined(yield* publishedAs(id, "members"));
      assert.isTrue(yield* unpublished);

      const heads = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) => {
            A.updateText(event, ["title"], "Listed");
            setTimes(event);
            setPlace(event);
            addTags(event, "Sosialt");
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
      assert.deepStrictEqual(published?.tags, ["Sosialt"]);
      assert.isFalse(yield* unpublished);
      assert.deepStrictEqual(
        (yield* publishedAs(id, "members"))?.publishedHeads,
        publication.heads,
      );

      yield* documents.applyChanges(
        id,
        [
          editor.edit((event) => {
            A.updateText(event, ["title"], "Listed again");
            addTags(event, "Fag");
          }),
        ],
        alice,
      );
      assert.strictEqual((yield* find)?.title, "Listed again");
      assert.deepStrictEqual((yield* find)?.tags, ["Sosialt", "Fag"]);
      assert.isTrue(yield* unpublished);
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

  it.effect("finishes a delete whose caller went away part way", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* publishedEvent({ public: true, guests: false });

      yield* interruptedWhileLocked("documents", documents.delete(id, alice));
      assert.isUndefined(yield* publishedAs(id, "members"));
      assert.isUndefined(yield* syncedDocument(id));
    }),
  );
});
