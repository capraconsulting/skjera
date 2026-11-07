import { PgClient } from "@effect/sql-pg";
import { Config, Effect, Layer } from "effect";
import { Migrator, type SqlClient } from "effect/sql";
import { installDatabaseObjects } from "./databaseObjects.ts";
import { migrations } from "./migrations.ts";

/** Runs pending migrations, then provides the Postgres client. */
export const layerFrom = <E>(
  client: Layer.Layer<PgClient.PgClient | SqlClient.SqlClient, E>,
) =>
  Layer.effectDiscard(
    Migrator.make({})({ loader: migrations }).pipe(
      Effect.andThen(installDatabaseObjects),
    ),
  ).pipe(Layer.provideMerge(client));

/** Connects to `DATABASE_URL`. */
export const layer = layerFrom(
  PgClient.layerConfig({ url: Config.Redacted("DATABASE_URL") }),
);
