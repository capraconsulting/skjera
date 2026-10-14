import { PgClient } from "@effect/sql-pg";
import { Config, Layer } from "effect";
import { Migrator, type SqlClient } from "effect/sql";
import { migrations } from "./migrations.ts";

/** Runs pending migrations, then provides the Postgres client. */
export const layerFrom = <E>(
  client: Layer.Layer<PgClient.PgClient | SqlClient.SqlClient, E>,
) =>
  Layer.effectDiscard(Migrator.make({})({ loader: migrations })).pipe(
    Layer.provideMerge(client),
  );

/** Connects to `DATABASE_URL`. */
export const layer = layerFrom(
  PgClient.layerConfig({ url: Config.Redacted("DATABASE_URL") }),
);
