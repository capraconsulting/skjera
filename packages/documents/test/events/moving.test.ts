import { assert, layer } from "@effect/vitest";
import { Effect } from "effect";
import { Documents } from "../../src/events/Documents.ts";
import type { DocumentId } from "../../src/Model.ts";
import { alice, newTeam, publishedEvent, TestLayer } from "../helpers.ts";

const newId = () => crypto.randomUUID() as DocumentId;

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Moving an event", (it) => {
  it.effect(
    "moves an event that has never been published to another team (AC-2)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const from = yield* newTeam;
        const to = yield* newTeam;
        const id = yield* documents.create("event", from, alice);

        yield* documents.move(id, to);

        assert.strictEqual((yield* documents.get(id)).teamId, to);
      }),
  );

  it.effect(
    "moves the copy of a published event, which has never been published itself (AC-2)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const source = yield* publishedEvent({ public: true, guests: false });
        const copy = newId();
        yield* documents.copy(source, copy, alice);
        const to = yield* newTeam;

        yield* documents.move(copy, to);

        assert.strictEqual((yield* documents.get(copy)).teamId, to);
      }),
  );

  it.effect(
    "fails for a team that does not exist and leaves the event where it was (AC-2)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const from = yield* newTeam;
        const id = yield* documents.create("event", from, alice);

        const error = yield* Effect.flip(
          documents.move(id, crypto.randomUUID() as typeof from),
        );

        assert.strictEqual(error._tag, "TeamNotFound");
        assert.strictEqual((yield* documents.get(id)).teamId, from);
      }),
  );

  it.effect("fails for an event that is deleted (AC-2)", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      yield* documents.delete(id, alice);

      const error = yield* Effect.flip(documents.move(id, yield* newTeam));

      assert.strictEqual(error._tag, "DocumentNotFound");
    }),
  );

  it.effect(
    "refuses a published event with the problem OrganizerLocked, and leaves it in its team (AC-4)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const id = yield* publishedEvent({ public: true, guests: false });
        const team = (yield* documents.get(id)).teamId;

        const error = yield* Effect.flip(documents.move(id, yield* newTeam));

        assert.strictEqual(error._tag, "MoveRejected");
        if (error._tag === "MoveRejected") {
          assert.strictEqual(error.problem._tag, "OrganizerLocked");
        }
        assert.strictEqual((yield* documents.get(id)).teamId, team);
      }),
  );

  it.effect(
    "refuses an event that was published and then unpublished (AC-4)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const id = yield* publishedEvent({ public: true, guests: false });
        const team = (yield* documents.get(id)).teamId;
        yield* documents.unpublish(id);

        const error = yield* Effect.flip(documents.move(id, yield* newTeam));

        assert.strictEqual(error._tag, "MoveRejected");
        assert.strictEqual((yield* documents.get(id)).teamId, team);
      }),
  );
});
