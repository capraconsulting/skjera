import * as A from "@automerge/automerge";
import { assert, layer } from "@effect/vitest";
import { Identity } from "@skjera/oauth/api";
import { Effect, Fiber, Layer, Stream } from "effect";
import { SqlClient } from "effect/sql";
import type { Post } from "../src/ContentTypes.ts";
import { DocumentEvents } from "../src/DocumentEvents.ts";
import { Documents } from "../src/Documents.ts";
import type { TeamId } from "../src/Model.ts";
import { PublishedPosts } from "../src/PublishedPosts.ts";
import { Teams } from "../src/Teams.ts";
import { TestDatabase } from "./TestDatabase.ts";

const alice = new Identity({ issuer: "https://idp.example", subject: "alice" });
const bob = new Identity({ issuer: "https://idp.example", subject: "bob" });

const TestLayer = Layer.mergeAll(
  Documents.layer,
  DocumentEvents.layer,
  PublishedPosts.layer,
  Teams.layer,
).pipe(Layer.provideMerge(TestDatabase));

let teamCount = 0;
/** A team of its own for each test. */
const newTeam = Effect.gen(function* () {
  const teams = yield* Teams;
  teamCount += 1;
  return (yield* teams.create(`Team ${teamCount}`, alice)).id;
}).pipe(Effect.orDie);

/** An editor session: a replica of the draft with its own actor id. */
const openEditor = Effect.fn(function* (
  id: Parameters<Documents["Service"]["get"]>[0],
  user: Identity,
) {
  const documents = yield* Documents;
  const snapshot = yield* documents.get(id);
  let doc = A.load<Post>(snapshot.draft);
  yield* documents.registerActor(id, A.getActorId(doc), user);
  return {
    doc: () => doc,
    /** Makes a local change and returns it, as the editor would send it. */
    edit: (fn: (post: Post) => void) => {
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
      const id = yield* documents.create("post", yield* newTeam, alice);
      const snapshot = yield* documents.get(id);
      assert.strictEqual(snapshot.type, "post");
      assert.deepStrictEqual(A.toJS(A.load(snapshot.draft)), {
        title: "",
        body: "",
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
      const id = yield* documents.create("post", yield* newTeam, alice);
      const aliceEditor = yield* openEditor(id, alice);
      const bobEditor = yield* openEditor(id, bob);

      yield* documents.applyChanges(
        id,
        [aliceEditor.edit((post) => A.updateText(post, ["title"], "Hello"))],
        alice,
      );
      const heads = yield* documents.applyChanges(
        id,
        [bobEditor.edit((post) => A.updateText(post, ["body"], "World"))],
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
      const id = yield* documents.create("post", yield* newTeam, alice);
      const editor = yield* openEditor(id, alice);
      const change = editor.edit((post) =>
        A.updateText(post, ["title"], "Once"),
      );
      const first = yield* documents.applyChanges(id, [change], alice);
      const again = yield* documents.applyChanges(id, [change], alice);
      assert.deepStrictEqual(again, first);
    }),
  );

  it.effect("only accepts changes from the sender's own actor ids", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("post", yield* newTeam, alice);
      const aliceEditor = yield* openEditor(id, alice);
      const change = aliceEditor.edit((post) =>
        A.updateText(post, ["title"], "Mine"),
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
      const id = yield* documents.create("post", yield* newTeam, alice);
      const editor = yield* openEditor(id, alice);
      const before = (yield* documents.get(id)).heads;

      const extraField = yield* Effect.flip(
        documents.applyChanges(
          id,
          [editor.edit((post) => Object.assign(post, { secret: "x" }))],
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
          [fresh.edit((post) => Object.assign(post, { title: 42 }))],
          alice,
        ),
      );
      assert.strictEqual(wrongType._tag, "InvalidContent");

      assert.deepStrictEqual((yield* documents.get(id)).heads, before);
    }),
  );

  it.effect("rejects changes whose dependencies it hasn't seen", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("post", yield* newTeam, alice);
      const editor = yield* openEditor(id, alice);
      editor.edit((post) => A.updateText(post, ["title"], "First"));
      const second = editor.edit((post) =>
        A.updateText(post, ["title"], "Second"),
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
      const id = yield* documents.create("post", yield* newTeam, alice);
      const editor = yield* openEditor(id, alice);

      const seen = yield* documents.applyChanges(
        id,
        [
          editor.edit((post) => {
            A.updateText(post, ["title"], "Launch");
            A.updateText(post, ["body"], "We're live");
          }),
        ],
        alice,
      );
      // Someone keeps typing while Alice clicks publish.
      yield* documents.applyChanges(
        id,
        [editor.edit((post) => A.updateText(post, ["title"], "Launch day!"))],
        alice,
      );

      const first = yield* documents.publish(id, seen, alice);
      assert.deepStrictEqual(first.heads, seen);
      const [row] = yield* sql<{ title: string; body: string }>`
        SELECT title, body FROM posts WHERE id = ${id}
      `;
      assert.deepStrictEqual(row, { title: "Launch", body: "We're live" });

      const latest = (yield* documents.get(id)).heads;
      const second = yield* documents.publish(id, latest, alice);
      assert.deepStrictEqual(second.firstPublishedAt, first.firstPublishedAt);
      assert.isTrue(second.publishedAt >= first.publishedAt);
      const [updated] = yield* sql<{ title: string }>`
        SELECT title FROM posts WHERE id = ${id}
      `;
      assert.strictEqual(updated?.title, "Launch day!");
    }),
  );

  it.effect("refuses to publish an untitled post or an unknown version", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("post", yield* newTeam, alice);
      const untitled = yield* Effect.flip(
        documents.publish(id, (yield* documents.get(id)).heads, alice),
      );
      assert.strictEqual(untitled._tag, "PublishRejected");

      const unknown = yield* Effect.flip(
        documents.publish(id, ["00".repeat(32)], alice),
      );
      assert.strictEqual(unknown._tag, "PublishRejected");
    }),
  );

  it.effect("lists posts with their publish state", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const team = yield* newTeam;
      const id = yield* documents.create("post", team, alice);
      const editor = yield* openEditor(id, alice);
      const find = Effect.map(documents.list("post", team), (rows) =>
        rows.find((row) => row.id === id),
      );

      const draft = yield* find;
      assert.strictEqual(draft?.publishedAt, null);
      assert.isTrue(draft?.hasUnpublishedChanges);
      assert.isNull(yield* documents.publication(id));

      const heads = yield* documents.applyChanges(
        id,
        [editor.edit((post) => A.updateText(post, ["title"], "Listed"))],
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
        [editor.edit((post) => A.updateText(post, ["title"], "Listed again"))],
        alice,
      );
      assert.isTrue((yield* find)?.hasUnpublishedChanges);
    }),
  );

  it.effect("shows the public only what was published", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const published = yield* PublishedPosts;
      const id = yield* documents.create("post", yield* newTeam, alice);
      const editor = yield* openEditor(id, alice);
      const heads = yield* documents.applyChanges(
        id,
        [editor.edit((post) => A.updateText(post, ["title"], "Public"))],
        alice,
      );

      // A draft is invisible until it is published.
      const hidden = yield* Effect.flip(published.get(id));
      assert.strictEqual(hidden._tag, "PostNotFound");

      yield* documents.publish(id, heads, alice);
      yield* documents.applyChanges(
        id,
        [editor.edit((post) => A.updateText(post, ["title"], "Secret draft"))],
        alice,
      );

      // Edits after publishing stay private until republished.
      assert.strictEqual((yield* published.get(id)).title, "Public");
      const listed = (yield* published.list).find((post) => post.id === id);
      assert.strictEqual(listed?.title, "Public");
    }),
  );

  it.effect("deletes a document and its published version", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const published = yield* PublishedPosts;
      const id = yield* documents.create("post", yield* newTeam, alice);
      const editor = yield* openEditor(id, alice);
      const heads = yield* documents.applyChanges(
        id,
        [editor.edit((post) => A.updateText(post, ["title"], "Short-lived"))],
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
        "PostNotFound",
      );
      assert.strictEqual(
        (yield* Effect.flip(documents.delete(id)))._tag,
        "DocumentNotFound",
      );
    }),
  );

  it.effect("lists a team's posts only", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const [red, blue] = [yield* newTeam, yield* newTeam];
      const redPost = yield* documents.create("post", red, alice);
      const bluePost = yield* documents.create("post", blue, alice);

      const ids = (rows: ReadonlyArray<{ readonly id: string }>) =>
        rows.map((row) => row.id);
      assert.deepStrictEqual(ids(yield* documents.list("post", red)), [
        redPost,
      ]);
      assert.deepStrictEqual(ids(yield* documents.list("post", blue)), [
        bluePost,
      ]);
      assert.strictEqual((yield* documents.get(redPost)).teamId, red);
    }),
  );

  it.effect("creates posts only in existing teams", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const error = yield* Effect.flip(
        documents.create(
          "post",
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

      // A team with posts can't be deleted; an empty one can.
      const post = yield* documents.create("post", team.id, alice);
      const notEmpty = yield* Effect.flip(teams.delete(team.id));
      assert.strictEqual(notEmpty._tag, "TeamNotEmpty");
      yield* documents.delete(post);
      yield* teams.delete(team.id);
      const gone = yield* Effect.flip(teams.get(team.id));
      assert.strictEqual(gone._tag, "TeamNotFound");
    }),
  );

  it.effect("announces committed changes with their heads", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const { events } = yield* DocumentEvents;
      const id = yield* documents.create("post", yield* newTeam, alice);
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
        [editor.edit((post) => A.updateText(post, ["title"], "Ping"))],
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
      const id = yield* documents.create("post", yield* newTeam, alice);
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
        [editor.edit((post) => A.updateText(post, ["title"], "Still here"))],
        alice,
      );

      const tags = (yield* Fiber.join(received)).map((event) => event._tag);
      assert.deepStrictEqual(tags, ["ListenerReconnected", "DocumentChanged"]);
    }).pipe(Effect.timeout("10 seconds")),
  );
});
