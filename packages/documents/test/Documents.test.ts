import * as A from "@automerge/automerge";
import { assert, layer } from "@effect/vitest";
import { Identity } from "@skjera/oauth/api";
import { Effect, Fiber, Layer, Stream } from "effect";
import { SqlClient } from "effect/sql";
import type { EventContent } from "../src/ContentTypes.ts";
import { DocumentEvents } from "../src/DocumentEvents.ts";
import { Documents } from "../src/Documents.ts";
import type { TeamId } from "../src/Model.ts";
import { PublishedEvents } from "../src/PublishedEvents.ts";
import { Teams } from "../src/Teams.ts";
import { TestDatabase } from "./TestDatabase.ts";

const alice = new Identity({ issuer: "https://idp.example", subject: "alice" });
const bob = new Identity({ issuer: "https://idp.example", subject: "bob" });

const TestLayer = Layer.mergeAll(
  Documents.layer,
  DocumentEvents.layer,
  PublishedEvents.layer,
  Teams.layer,
).pipe(Layer.provideMerge(TestDatabase));

let teamCount = 0;
/** A team of its own for each test. */
const newTeam = Effect.gen(function* () {
  const teams = yield* Teams;
  teamCount += 1;
  return (yield* teams.create(`Team ${teamCount}`, alice)).id;
}).pipe(Effect.orDie);

/** Sets the date the way the editor does: a value replaced as a whole. */
const setDate = (event: EventContent, date: string) => {
  (event as { date: unknown }).date = new A.ImmutableString(date);
};

/** An editor session: a replica of the draft with its own actor id. */
const openEditor = Effect.fn(function* (
  id: Parameters<Documents["Service"]["get"]>[0],
  user: Identity,
) {
  const documents = yield* Documents;
  const snapshot = yield* documents.get(id);
  let doc = A.load<EventContent>(snapshot.draft);
  yield* documents.registerActor(id, A.getActorId(doc), user);
  return {
    doc: () => doc,
    /** Makes a local change and returns it, as the editor would send it. */
    edit: (fn: (event: EventContent) => void) => {
      doc = A.change(doc, fn);
      const change = A.getLastLocalChange(doc);
      if (change === undefined) throw new Error("no change");
      return change;
    },
    receive: (changes: Uint8Array) => {
      doc = A.loadIncremental(doc, changes);
    },
  };
});

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Documents", (it) => {
  it.effect("creates an empty draft", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const snapshot = yield* documents.get(id);
      assert.strictEqual(snapshot.type, "event");
      assert.deepStrictEqual(A.toJS(A.load(snapshot.draft)), {
        title: "",
        body: "",
        date: null,
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
      const aliceEditor = yield* openEditor(id, alice);
      const bobEditor = yield* openEditor(id, bob);

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
      aliceEditor.receive(
        yield* documents.changesSince(id, A.getHeads(aliceEditor.doc())),
      );
      bobEditor.receive(
        yield* documents.changesSince(id, A.getHeads(bobEditor.doc())),
      );
      for (const editor of [aliceEditor, bobEditor]) {
        assert.deepStrictEqual(A.toJS(editor.doc()), {
          title: "Hello",
          body: "World",
          date: null,
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
      const editor = yield* openEditor(id, alice);
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
      const aliceEditor = yield* openEditor(id, alice);
      const change = aliceEditor.edit((event) =>
        A.updateText(event, ["title"], "Mine"),
      );

      // Bob can't send Alice's changes, nor claim her actor id.
      const sent = yield* Effect.flip(
        documents.applyChanges(id, [change], bob),
      );
      assert.strictEqual(sent._tag, "ActorNotAllowed");
      const claimed = yield* Effect.flip(
        documents.registerActor(id, A.getActorId(aliceEditor.doc()), bob),
      );
      assert.strictEqual(claimed._tag, "ActorNotAllowed");
    }),
  );

  it.effect("rejects changes that don't fit the content type", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id, alice);
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
      const fresh = yield* openEditor(id, alice);
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

  it.effect("only accepts real calendar dates", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      for (const date of ["2026-02-30", "15.10.2026", "2026-10-15T12:00"]) {
        const editor = yield* openEditor(id, alice);
        const error = yield* Effect.flip(
          documents.applyChanges(
            id,
            [editor.edit((event) => setDate(event, date))],
            alice,
          ),
        );
        assert.strictEqual(error._tag, "InvalidContent", date);
      }
    }),
  );

  it.effect("rejects changes whose dependencies it hasn't seen", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id, alice);
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

  it.effect("publishes the version the user saw", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const sql = yield* SqlClient.SqlClient;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id, alice);

      const seen = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) => {
            A.updateText(event, ["title"], "Launch");
            A.updateText(event, ["body"], "We're live");
            setDate(event, "2026-10-15");
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
      const [row] = yield* sql<{ title: string; body: string; date: string }>`
        SELECT title, body, event_date::text AS date FROM events WHERE id = ${id}
      `;
      assert.deepStrictEqual(row, {
        title: "Launch",
        body: "We're live",
        date: "2026-10-15",
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
    "refuses to publish without a title or date, or an unknown version",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const id = yield* documents.create("event", yield* newTeam, alice);
        const editor = yield* openEditor(id, alice);
        const blank = (yield* documents.get(id)).heads;
        const dated = yield* documents.applyChanges(
          id,
          [editor.edit((event) => setDate(event, "2026-10-15"))],
          alice,
        );
        const empty = yield* Effect.flip(documents.publish(id, blank, alice));
        assert.strictEqual(
          empty.message,
          "Add a title and a date before publishing",
        );
        const untitled = yield* Effect.flip(
          documents.publish(id, dated, alice),
        );
        assert.strictEqual(untitled.message, "Add a title before publishing");

        const titled = yield* documents.applyChanges(
          id,
          [
            editor.edit((event) => {
              A.updateText(event, ["title"], "Dateless");
              (event as { date: unknown }).date = null;
            }),
          ],
          alice,
        );
        const undated = yield* Effect.flip(
          documents.publish(id, titled, alice),
        );
        assert.strictEqual(undated.message, "Add a date before publishing");

        const unknown = yield* Effect.flip(
          documents.publish(id, ["00".repeat(32)], alice),
        );
        assert.strictEqual(unknown._tag, "PublishRejected");
      }),
  );

  it.effect("lists events with their publish state", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const team = yield* newTeam;
      const id = yield* documents.create("event", team, alice);
      const editor = yield* openEditor(id, alice);
      const find = Effect.map(documents.list("event", team), (rows) =>
        rows.find((row) => row.id === id),
      );

      const draft = yield* find;
      assert.strictEqual(draft?.publishedAt, null);
      assert.isTrue(draft?.hasUnpublishedChanges);
      assert.isNull(yield* documents.publication(id));

      const heads = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) => {
            A.updateText(event, ["title"], "Listed");
            setDate(event, "2026-10-15");
          }),
        ],
        alice,
      );
      const publication = yield* documents.publish(id, heads, alice);
      const published = yield* find;
      assert.strictEqual(published?.title, "Listed");
      assert.isFalse(published?.hasUnpublishedChanges);
      assert.deepStrictEqual(
        (yield* documents.publication(id))?.heads,
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
      assert.isTrue((yield* find)?.hasUnpublishedChanges);
    }),
  );

  it.effect("shows the public only what was published", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const published = yield* PublishedEvents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id, alice);
      const heads = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) => {
            A.updateText(event, ["title"], "Public");
            setDate(event, "2026-10-15");
          }),
        ],
        alice,
      );

      // A draft is invisible until it is published.
      const hidden = yield* Effect.flip(published.get(id));
      assert.strictEqual(hidden._tag, "EventNotFound");

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
      assert.strictEqual((yield* published.get(id)).title, "Public");
      const listed = (yield* published.list).find((event) => event.id === id);
      assert.strictEqual(listed?.title, "Public");
    }),
  );

  it.effect("deletes a document and its published version", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const published = yield* PublishedEvents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id, alice);
      const heads = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) => {
            A.updateText(event, ["title"], "Short-lived");
            setDate(event, "2026-10-15");
          }),
        ],
        alice,
      );
      yield* documents.publish(id, heads, alice);

      yield* documents.delete(id);
      assert.strictEqual(
        (yield* Effect.flip(documents.get(id)))._tag,
        "DocumentNotFound",
      );
      assert.strictEqual(
        (yield* Effect.flip(published.get(id)))._tag,
        "EventNotFound",
      );
      assert.strictEqual(
        (yield* Effect.flip(documents.delete(id)))._tag,
        "DocumentNotFound",
      );
    }),
  );

  it.effect("lists a team's events only", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const [red, blue] = [yield* newTeam, yield* newTeam];
      const redEvent = yield* documents.create("event", red, alice);
      const blueEvent = yield* documents.create("event", blue, alice);

      const ids = (rows: ReadonlyArray<{ readonly id: string }>) =>
        rows.map((row) => row.id);
      assert.deepStrictEqual(ids(yield* documents.list("event", red)), [
        redEvent,
      ]);
      assert.deepStrictEqual(ids(yield* documents.list("event", blue)), [
        blueEvent,
      ]);
      assert.strictEqual((yield* documents.get(redEvent)).teamId, red);
    }),
  );

  it.effect("creates events only in existing teams", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const error = yield* Effect.flip(
        documents.create(
          "event",
          "01a0f2ff-0000-7000-8000-000000000000" as TeamId,
          alice,
        ),
      );
      assert.strictEqual(error._tag, "TeamNotFound");
    }),
  );

  it.effect("creates, lists and deletes teams", () =>
    Effect.gen(function* () {
      const teams = yield* Teams;
      const documents = yield* Documents;
      const team = yield* teams.create("  Zebra crew  ", alice);
      assert.strictEqual(team.name, "Zebra crew");
      assert.isTrue((yield* teams.list).some((each) => each.id === team.id));
      assert.strictEqual((yield* teams.get(team.id)).name, "Zebra crew");

      // Names are unique regardless of case, and can't be blank.
      const taken = yield* Effect.flip(teams.create("zebra CREW", bob));
      assert.strictEqual(taken._tag, "InvalidTeamName");
      const blank = yield* Effect.flip(teams.create("   ", bob));
      assert.strictEqual(blank._tag, "InvalidTeamName");

      // A team with events can't be deleted; an empty one can.
      const event = yield* documents.create("event", team.id, alice);
      const notEmpty = yield* Effect.flip(teams.delete(team.id));
      assert.strictEqual(notEmpty._tag, "TeamNotEmpty");
      yield* documents.delete(event);
      yield* teams.delete(team.id);
      const gone = yield* Effect.flip(teams.get(team.id));
      assert.strictEqual(gone._tag, "TeamNotFound");
    }),
  );

  it.effect("announces committed changes with their heads", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const { events } = yield* DocumentEvents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id, alice);

      const next = yield* events.pipe(
        Stream.filter(
          (event) =>
            event._tag === "DocumentChanged" &&
            event.id === id &&
            event.op === "UPDATE",
        ),
        Stream.runHead,
        Effect.forkChild,
      );
      // Let the subscriber attach before the change commits.
      yield* Effect.sleep("100 millis");
      const heads = yield* documents.applyChanges(
        id,
        [editor.edit((event) => A.updateText(event, ["title"], "Ping"))],
        alice,
      );
      const event = yield* Fiber.join(next);
      assert.isTrue(event._tag === "Some");
      if (event._tag === "Some" && event.value._tag === "DocumentChanged") {
        assert.deepStrictEqual(event.value.heads, heads);
      }
    }).pipe(Effect.timeout("5 seconds")),
  );

  it.effect("reconnects the listener and asks subscribers to catch up", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const { events } = yield* DocumentEvents;
      const sql = yield* SqlClient.SqlClient;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id, alice);

      const received = yield* events.pipe(
        Stream.filter(
          (event) =>
            event._tag === "ListenerReconnected" ||
            (event.id === id && event.op === "UPDATE"),
        ),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Effect.sleep("100 millis");

      // Drop the listening connection, as a network failure would.
      yield* sql`
        SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = current_database() AND query LIKE 'LISTEN%'
      `;
      yield* Effect.sleep("1500 millis");
      yield* documents.applyChanges(
        id,
        [editor.edit((event) => A.updateText(event, ["title"], "Still here"))],
        alice,
      );

      const tags = (yield* Fiber.join(received)).map((event) => event._tag);
      assert.deepStrictEqual(tags, ["ListenerReconnected", "DocumentChanged"]);
    }).pipe(Effect.timeout("10 seconds")),
  );
});
