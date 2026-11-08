import { randomBytes } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect, Layer, Redacted } from "effect";
import { SqlClient } from "effect/sql";

export type Env = Readonly<Record<string, string | undefined>>;

export const databaseServerUrl = (env: Env): string =>
  env.DATABASE_URL ?? "postgres://skjera:skjera@localhost:5433/skjera";

export const databaseUrl = (serverUrl: string, name: string): string => {
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return url.href;
};

export const databaseName = (prefix: string): string =>
  `${prefix}_${randomBytes(6).toString("hex")}`;

export const onDatabaseServer = <A, E>(
  serverUrl: string,
  query: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    return yield* query(yield* SqlClient.SqlClient);
  }).pipe(Effect.provide(PgClient.layer({ url: Redacted.make(serverUrl) })));

export const newDatabaseLayer = (
  prefix: string,
  serverUrl = databaseServerUrl(process.env),
) =>
  Effect.gen(function* () {
    const name = databaseName(prefix);
    yield* Effect.acquireRelease(
      onDatabaseServer(serverUrl, (sql) =>
        sql.unsafe(`CREATE DATABASE ${name}`),
      ),
      () =>
        onDatabaseServer(serverUrl, (sql) =>
          sql.unsafe(`DROP DATABASE ${name} WITH (FORCE)`),
        ).pipe(Effect.orDie),
    );
    return PgClient.layer({
      url: Redacted.make(databaseUrl(serverUrl, name)),
    });
  }).pipe(Effect.orDie);

export const scopedDatabaseLayer = (
  prefix: string,
  serverUrl = databaseServerUrl(process.env),
) => Layer.unwrap(newDatabaseLayer(prefix, serverUrl));

export const temporaryDatabase = async <A>(
  serverUrl: string,
  prefix: string,
  execute: (statement: string) => Promise<void>,
  use: (url: string) => Promise<A>,
): Promise<A> => {
  const name = databaseName(prefix);
  await execute(`CREATE DATABASE ${name}`);
  try {
    return await use(databaseUrl(serverUrl, name));
  } finally {
    await execute(`DROP DATABASE ${name} WITH (FORCE)`);
  }
};
