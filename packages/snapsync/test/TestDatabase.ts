import { newDatabaseLayer } from "@skjera/test/database";
import { Effect, Layer } from "effect";
import { install } from "../src/server.ts";

/** A new database with snapsync for one test file, dropped afterwards. */
export const TestDatabase = Layer.unwrap(
  Effect.gen(function* () {
    const client = yield* newDatabaseLayer("snapsync_test");
    return Layer.effectDiscard(
      // Installed as the app does, not as an extension.
      install,
    ).pipe(Layer.provideMerge(client));
  }).pipe(Effect.orDie),
);
