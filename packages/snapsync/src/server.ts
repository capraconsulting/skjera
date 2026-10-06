import { readFileSync } from "node:fs";
import { Duration, Effect, Layer, Schedule } from "effect";
import { SqlClient, type SqlError } from "effect/sql";
import type { Pulled, Token } from "./schema.ts";

// Pulling from tables tracked by snapsync, a page at a time, and keeping it
// well. Needs snapsync installed (`install`, or `CREATE EXTENSION snapsync`)
// and `snapsync.track()` for each table (see the README).

/** The version `install` installs. */
export const version = "0.1.0";

/**
 * Installs snapsync without the extension: the extension's script, run as
 * is in a schema of its own, by whoever runs it (no superuser needed). So
 * the database server needs no files of ours: for when it's run elsewhere.
 * Once per database, e.g. in a migration.
 */
export const install = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const script = readFileSync(
    new URL(`../extension/snapsync--${version}.sql`, import.meta.url),
    "utf8",
  )
    // Only for CREATE EXTENSION: refusing to run otherwise, and keeping
    // the tables in dumps, as they are anyway when not an extension's.
    .replace(/^\\echo .*$/m, "")
    .replace(/^SELECT pg_catalog\.pg_extension_config_dump\(.*$/gm, "");
  // One statement per query here, but EXECUTE runs a script.
  yield* sql.unsafe(
    `DO $install$ BEGIN EXECUTE $script$CREATE SCHEMA snapsync;\n${script}$script$; END $install$`,
  );
});

/** How many changes a page holds, unless told otherwise. */
export const defaultPageSize = 1000;

/**
 * Pulls a page of what changed in `table` since `since`: the rows changed
 * that the reader may see (`load`), the keys deleted, and the token to pull
 * from next. With `more`, pull again from it right away. All of it in one
 * snapshot, so nothing is missed between pulls, however transactions
 * interleave or commit. Without a token, or with one that can't be pulled
 * from, it starts over with every row (`complete`).
 */
export const pull = <Row, E, R>(options: {
  /** The tracked table, e.g. "attendees". */
  readonly table: string;
  readonly since: Token | undefined;
  /**
   * The rows with these keys that the reader may see. Changed rows left
   * out are pulled as deleted, so they leave the reader's copy.
   */
  readonly load: (
    keys: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<Row>, E, R>;
  readonly getKey: (row: Row) => string;
  /** At most this many changes; defaults to `defaultPageSize`. */
  readonly pageSize?: number;
}): Effect.Effect<
  Pulled<Row>,
  E | SqlError.SqlError,
  R | SqlClient.SqlClient
> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* Effect.gen(function* () {
      // One snapshot for the page: its keys, rows and the next token.
      yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
      const [page] = yield* sql<{
        changed: ReadonlyArray<string>;
        deleted: ReadonlyArray<string>;
        next_token: string;
        complete: boolean;
        more: boolean;
      }>`
        SELECT changed, deleted, next_token, complete, more
        FROM snapsync.changes(${options.table}::regclass,
          ${options.since ?? null}, ${options.pageSize ?? defaultPageSize})
      `;
      if (page === undefined) return yield* Effect.die("No page");
      const rows =
        page.changed.length === 0 ? [] : yield* options.load(page.changed);
      const loaded = new Set(rows.map(options.getKey));
      return {
        rows,
        deleted: [
          ...page.deleted,
          // Changed, but not the reader's to see (anymore).
          ...page.changed.filter((key) => !loaded.has(key)),
        ],
        complete: page.complete,
        more: page.more,
        token: page.next_token,
      };
    }).pipe(sql.withTransaction);
  });

/**
 * After a restore into another cluster or database, stamps every tracked
 * row anew, so clients start over (see `snapsync.ensure_current()`). Run it
 * when connecting, before serving pulls. Returns whether it had to.
 */
export const ensureCurrent: Effect.Effect<
  boolean,
  SqlError.SqlError,
  SqlClient.SqlClient
> = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const [check] = yield* sql<{ restamped: boolean }>`
    SELECT snapsync.ensure_current() AS restamped
  `;
  const restamped = check?.restamped ?? false;
  if (restamped) {
    yield* Effect.logWarning(
      "snapsync: restored from elsewhere; every tracked row is new to clients",
    );
  }
  return restamped;
});

/** How long tombstones are kept, unless told otherwise. */
export const defaultRetention: Duration.Input = "30 days";

/**
 * Forgets tombstones older than `retention` (see `snapsync.prune()`).
 * Clients that last pulled before the newest one forgotten start over.
 * Returns how many were forgotten. Run it once across instances, e.g. as a
 * cluster cron job; `maintain()` runs it in every instance.
 */
export const prune = (
  retention: Duration.Input = defaultRetention,
): Effect.Effect<number, SqlError.SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ forgotten: string }>`
      SELECT snapsync.prune(${`${Duration.toMillis(Duration.fromInputUnsafe(retention))} milliseconds`}::interval) AS forgotten
    `;
    const forgotten = Number(row?.forgotten ?? 0);
    if (forgotten > 0) {
      yield* Effect.logInfo(`snapsync: forgot ${forgotten} tombstones`);
    }
    return forgotten;
  });

/**
 * Keeps snapsync well while the layer is up, in this instance: first
 * `ensureCurrent`, then `prune` every `every`. With several instances,
 * prefer running `prune` once across them.
 */
export const maintain = (
  options: {
    readonly retention?: Duration.Input;
    readonly every?: Duration.Input;
  } = {},
) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      yield* ensureCurrent;
      yield* prune(options.retention).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("snapsync: pruning failed", cause),
        ),
        Effect.repeat(Schedule.spaced(options.every ?? "1 hour")),
        Effect.forkScoped,
      );
    }),
  );
