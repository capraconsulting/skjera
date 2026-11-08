import { newDatabaseLayer } from "@skjera/test/database";
import { Effect, Layer } from "effect";
import * as Database from "../src/server/Database.ts";

/** A new database for the layer's life, dropped afterwards: its client. */
const newDatabase = newDatabaseLayer("skjera_test");

/** A new, migrated database for one test file, dropped afterwards. */
export const TestDatabase = Layer.unwrap(
  Effect.map(newDatabase, (client) => Database.layerFrom(client)),
);

/** The same, only connected: the test runs the migrations itself. */
export const UnmigratedTestDatabase = Layer.unwrap(newDatabase);
