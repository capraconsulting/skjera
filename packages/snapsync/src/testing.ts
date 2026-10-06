import { Data, Effect, Random } from "effect";
import { SqlClient, SqlError } from "effect/sql";
import type { Pulled, Token } from "./schema.ts";

// Testing pulls the way they fail: with writes committing out of order while
// clients pull, then checking the clients' copies against the tables. After
// Cognite's load generator and consistency check for txid-based syncing
// (github.com/cognitedata/txid-syncing).

/** A copy of a table kept by pulling, as a client keeps one. */
export const replica = <Row, E, R>(options: {
  readonly getKey: (row: Row) => string;
  readonly pull: (since: Token | undefined) => Effect.Effect<Pulled<Row>, E, R>;
}) => {
  const rows = new Map<string, Row>();
  let since: Token | undefined;
  let pulls = 0;
  let pages = 0;
  let restarts = 0;
  return {
    /** The copy, by key. */
    rows: rows as ReadonlyMap<string, Row>,
    /**
     * Pulls until there's no more, as a client does: pages of changes
     * apply as they come; starting over, all pages replace the copy at once.
     */
    pull: Effect.gen(function* () {
      let token = since;
      let fresh: Map<string, Row> | null = null;
      for (;;) {
        const pulled = yield* options.pull(token);
        pages++;
        if (pulled.complete) {
          fresh = new Map();
          if (pulls > 0) restarts++;
        }
        const into = fresh ?? rows;
        for (const row of pulled.rows) into.set(options.getKey(row), row);
        for (const key of pulled.deleted) into.delete(key);
        if (fresh === null) since = pulled.token;
        token = pulled.token;
        if (!pulled.more) break;
      }
      if (fresh !== null) {
        rows.clear();
        for (const [key, row] of fresh) rows.set(key, row);
        since = token;
      }
      pulls++;
    }),
    /**
     * Pulls so far, the pages they took, and how many of the later pulls
     * started over.
     */
    stats: () => ({ pulls, pages, restarts }),
  };
};

class RolledBack extends Data.TaggedError("RolledBack")<{}> {}

/** Postgres refusing a transaction a writer would retry: serialization, deadlock. */
const refused = (error: SqlError.SqlError) => {
  const code = (error.reason as { cause?: { code?: string } }).cause?.code;
  return code === "40001" || code === "40P01";
};

/**
 * Writes the way that trips up syncing by timestamps or sequences: `writers`
 * transactions at a time, each doing `write`, then waiting up to `pauseMs`
 * before committing, so they commit in another order than they started.
 * One in `1 / rollbackRate` rolls back instead. Point `write` at a few hot
 * rows often, so concurrent transactions change the same ones. With
 * `isolation: "repeatable read"`, writers see one snapshot throughout; those
 * Postgres refuses (serialization failures, deadlocks) count as rolled back.
 * Returns how many transactions committed.
 */
export const concurrentWriters = <E, R>(options: {
  readonly writers: number;
  /** Per writer. */
  readonly transactions: number;
  readonly write: Effect.Effect<void, E, R>;
  readonly pauseMs?: number;
  readonly rollbackRate?: number;
  readonly isolation?: "read committed" | "repeatable read";
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    let committed = 0;
    const transaction = Effect.gen(function* () {
      if (options.isolation === "repeatable read") {
        yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
      }
      yield* options.write;
      yield* Effect.sleep(yield* Random.nextBetween(0, options.pauseMs ?? 20));
      if ((yield* Random.next) < (options.rollbackRate ?? 0.1)) {
        return yield* new RolledBack();
      }
    }).pipe(
      sql.withTransaction,
      Effect.andThen(
        Effect.sync(() => {
          committed++;
        }),
      ),
      Effect.catchTag("RolledBack", () => Effect.void),
      Effect.catchIf(
        (error): error is SqlError.SqlError =>
          SqlError.isSqlError(error) && refused(error),
        () => Effect.void,
      ),
    );
    yield* Effect.forEach(
      Array.from({ length: options.writers }),
      () => Effect.repeat(transaction, { times: options.transactions - 1 }),
      { concurrency: "unbounded", discard: true },
    );
    return committed;
  });

/**
 * How a copy differs from the table it copies: rows missing from it, rows
 * it has that the table doesn't, and rows that differ. Empty when equal.
 */
export const differences = <Row>(options: {
  readonly table: ReadonlyArray<Row>;
  readonly copy: ReadonlyMap<string, Row>;
  readonly getKey: (row: Row) => string;
  readonly equals?: (a: Row, b: Row) => boolean;
}) => {
  const equals =
    options.equals ??
    ((a: Row, b: Row) => JSON.stringify(a) === JSON.stringify(b));
  const keys = new Set<string>();
  const missing: Array<string> = [];
  const changed: Array<string> = [];
  for (const row of options.table) {
    const key = options.getKey(row);
    keys.add(key);
    const copied = options.copy.get(key);
    if (copied === undefined) missing.push(key);
    else if (!equals(row, copied)) changed.push(key);
  }
  const extra = [...options.copy.keys()].filter((key) => !keys.has(key));
  return { missing, extra, changed };
};
