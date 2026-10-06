import { Duration, Effect, Layer, Schedule } from "effect";
import { SqlClient, type SqlError, type Statement } from "effect/sql";
import type { Pulled, Token } from "./schema.ts";

// Pulling from tables tracked by the snapsync extension, and keeping it
// well. Needs `CREATE EXTENSION snapsync` and `snapsync.track()` for each
// table (see the README).

/**
 * Whether the row whose transaction id is in `column` is new to the client:
 * a condition for a query's WHERE. Always true on a pull that starts over.
 */
export type Unseen = (column: string) => Statement.Fragment;

/** What a pull's query found. */
export interface Changes<Row> {
  /** Changed rows the reader may see. */
  readonly rows: ReadonlyArray<Row>;
  /**
   * Keys of changed rows the reader may not see (anymore): pulled as
   * deleted, so they leave the reader's copy.
   */
  readonly hidden?: ReadonlyArray<string>;
}

/**
 * Pulls what changed in `table` since `since`: the rows `select` finds with
 * the `unseen` condition, the keys deleted, and the token to pull from next.
 * All of it in one snapshot, so nothing is missed between pulls, however
 * transactions interleave or commit. Without a token, or with one that
 * can't be pulled from, everything (`complete`).
 */
export const pull = <Row, E, R>(options: {
  /** The tracked table the rows are from, e.g. "attendees". */
  readonly table: string;
  readonly since: Token | undefined;
  readonly select: (unseen: Unseen) => Effect.Effect<Changes<Row>, E, R>;
}): Effect.Effect<
  Pulled<Row>,
  E | SqlError.SqlError,
  R | SqlClient.SqlClient
> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* Effect.gen(function* () {
      yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
      const [check] = yield* sql<{ since: string | null }>`
        SELECT snapsync.since(${options.since ?? null}, ${options.table}::regclass)::text AS since
      `;
      const since = check?.since ?? null;
      // The snapshot as a value, so snapsync.unseen() is inlined and the
      // index on the xid column used.
      const unseen: Unseen = (column) =>
        since === null
          ? sql`true`
          : sql`snapsync.unseen(${sql.literal(column)}, ${since}::pg_snapshot)`;
      const changes = yield* options.select(unseen);
      const deleted =
        since === null
          ? []
          : yield* sql<{ key: string }>`
              SELECT key FROM snapsync.deleted(${options.table}::regclass, ${since}::pg_snapshot) AS key
            `;
      const [current] = yield* sql<{ token: string }>`
        SELECT snapsync.token(${options.table}::regclass) AS token
      `;
      if (current === undefined) return yield* Effect.die("No token");
      return {
        rows: changes.rows,
        deleted: [
          ...deleted.map((row) => row.key),
          // A copy starting over has nothing to remove them from.
          ...(since === null ? [] : (changes.hidden ?? [])),
        ],
        complete: since === null,
        token: current.token,
      };
    }).pipe(sql.withTransaction);
  });

/**
 * Keeps snapsync well while the layer is up: first, after a restore into
 * another cluster or database, stamps every tracked row anew (clients start
 * over), then forgets tombstones older than `retention` every `every`.
 * Clients that last pulled before the newest one forgotten start over.
 */
export const maintain = (
  options: {
    readonly retention?: Duration.Input;
    readonly every?: Duration.Input;
  } = {},
) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [check] = yield* sql<{ restamped: boolean }>`
        SELECT snapsync.ensure_current() AS restamped
      `;
      if (check?.restamped) {
        yield* Effect.logWarning(
          "snapsync: restored from elsewhere; every tracked row is new to clients",
        );
      }
      const retention = Duration.fromInputUnsafe(
        options.retention ?? "30 days",
      );
      const prune = sql<{ forgotten: string }>`
        SELECT snapsync.prune(${`${Duration.toMillis(retention)} milliseconds`}::interval) AS forgotten
      `.pipe(
        Effect.tap(([row]) =>
          row !== undefined && Number(row.forgotten) > 0
            ? Effect.logInfo(`snapsync: forgot ${row.forgotten} tombstones`)
            : Effect.void,
        ),
        Effect.catchCause((cause) =>
          Effect.logWarning("snapsync: pruning failed", cause),
        ),
      );
      yield* prune.pipe(
        Effect.repeat(Schedule.spaced(options.every ?? "1 hour")),
        Effect.forkScoped,
      );
    }),
  );
