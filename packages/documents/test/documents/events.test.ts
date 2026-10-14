import * as A from "@automerge/automerge";
import { assert, layer } from "@effect/vitest";
import { Effect, Exit, Fiber, Stream } from "effect";
import { SqlClient } from "effect/sql";
import { DocumentEvents } from "../../src/DocumentEvents.ts";
import { Documents } from "../../src/Documents.ts";
import { alice, newTeam, openEditor, TestLayer } from "../helpers.ts";

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("DocumentEvents", (it) => {
  it.effect("ends subscriptions with just an interrupt", () =>
    Effect.gen(function* () {
      const events = yield* DocumentEvents;
      const fiber = yield* Stream.unwrap(events.subscribe).pipe(
        Stream.runDrain,
        Effect.forkChild,
      );
      yield* Effect.sleep("50 millis");
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        assert.deepStrictEqual(
          exit.cause.reasons.map((reason) => reason._tag),
          ["Interrupt"],
        );
      }
    }),
  );

  it.effect("announces committed changes with their heads", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const events = yield* DocumentEvents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id);

      const next = yield* (yield* events.subscribe).pipe(
        Stream.filter(
          (event) =>
            event._tag === "DocumentChanged" &&
            event.id === id &&
            event.op === "UPDATE",
        ),
        Stream.runHead,
        Effect.forkChild,
      );
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
    }).pipe(Effect.scoped, Effect.timeout("5 seconds")),
  );

  it.effect("reconnects the listener and asks subscribers to catch up", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const events = yield* DocumentEvents;
      const sql = yield* SqlClient.SqlClient;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id);

      const received = yield* (yield* events.subscribe).pipe(
        Stream.filter(
          (event) =>
            event._tag === "ListenerReconnected" ||
            (event.id === id && event.op === "UPDATE"),
        ),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );

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
    }).pipe(Effect.scoped, Effect.timeout("10 seconds")),
  );
});
