import { randomBytes } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect, Layer, Redacted } from "effect";
import { SqlClient } from "effect/sql";
import * as Database from "../src/Database.ts";

const serverUrl =
  process.env.DATABASE_URL ?? "postgres://skjera:skjera@localhost:5433/skjera";

const onServer = <A, E>(
  query: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    return yield* query(yield* SqlClient.SqlClient);
  }).pipe(Effect.provide(PgClient.layer({ url: Redacted.make(serverUrl) })));

/** A new, migrated database for one test file, dropped afterwards. */
export const TestDatabase = Layer.unwrap(
  Effect.gen(function* () {
    const name = `skjera_test_${randomBytes(6).toString("hex")}`;
    yield* Effect.acquireRelease(
      onServer((sql) => sql.unsafe(`CREATE DATABASE ${name}`)),
      () =>
        onServer((sql) =>
          sql.unsafe(`DROP DATABASE ${name} WITH (FORCE)`),
        ).pipe(Effect.orDie),
    );
    const url = new URL(serverUrl);
    url.pathname = `/${name}`;
    return Database.layerFrom(PgClient.layer({ url: Redacted.make(url.href) }));
  }).pipe(Effect.orDie),
);
