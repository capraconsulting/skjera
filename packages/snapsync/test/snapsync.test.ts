import { assert, layer } from "@effect/vitest";
import { Deferred, Effect, Fiber, Random } from "effect";
import { SqlClient } from "effect/sql";
import type { Token } from "../src/schema.ts";
import * as Server from "../src/server.ts";
import { concurrentWriters, differences, replica } from "../src/testing.ts";
import { TestDatabase } from "./TestDatabase.ts";

interface Item {
  readonly id: string;
  readonly name: string;
}

let tables = 0;
/** A new tracked table of items, with some in it. */
const itemsTable = (rows = 0) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const table = `items_${++tables}`;
    yield* sql`CREATE TABLE ${sql(table)} (id text PRIMARY KEY, name text NOT NULL)`;
    yield* sql`
      INSERT INTO ${sql(table)} (id, name)
      SELECT 'item-' || n, 'Item ' || n FROM generate_series(1, ${rows}) AS n
    `;
    yield* sql`SELECT snapsync.track(${table})`;
    const pull = (since: Token | undefined) =>
      Server.pull({
        table,
        since,
        select: (unseen) =>
          sql<Item>`
            SELECT id, name FROM ${sql(table)} WHERE ${unseen("xid")} ORDER BY id
          `.pipe(Effect.map((rows) => ({ rows }))),
      });
    const all = sql<Item>`SELECT id, name FROM ${sql(table)} ORDER BY id`;
    /** What snapsync.status() says of a token for this table. */
    const status = (token: string | null) =>
      sql<{ status: string }>`
        SELECT snapsync.status(${token}, ${table}::regclass) AS status
      `.pipe(Effect.map(([row]) => row?.status));
    /** A token for this table, with a snapshot of nothing from `xmin` on. */
    const tokenAt = (xmin: bigint | string) =>
      Effect.gen(function* () {
        const [tracked] = yield* sql<{ generation: number; origin: string }>`
          SELECT generation, snapsync.origin() AS origin
          FROM snapsync.tables WHERE relation = ${table}::regclass
        `;
        return `1/${tracked?.origin}/${tracked?.generation}/${xmin}:${xmin}:`;
      });
    return { table, pull, all, status, tokenAt };
  });

const getKey = (item: Item) => item.id;
const ids = (items: ReadonlyArray<Item>) => items.map((item) => item.id);

// Real clock: these tests talk to a real database.
layer(TestDatabase, { excludeTestServices: true })("snapsync", (it) => {
  it.effect("pulls everything first, then what changed", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const { table, pull } = yield* itemsTable(3);
      const first = yield* pull(undefined);
      assert.isTrue(first.complete);
      assert.deepStrictEqual(ids(first.rows), ["item-1", "item-2", "item-3"]);

      const nothing = yield* pull(first.token);
      assert.deepStrictEqual(
        [nothing.complete, nothing.rows, nothing.deleted],
        [false, [], []],
      );

      yield* sql`UPDATE ${sql(table)} SET name = 'Renamed' WHERE id = 'item-2'`;
      yield* sql`DELETE FROM ${sql(table)} WHERE id = 'item-3'`;
      yield* sql`INSERT INTO ${sql(table)} (id, name) VALUES ('item-4', 'New')`;
      const changed = yield* pull(nothing.token);
      assert.isFalse(changed.complete);
      assert.deepStrictEqual(changed.rows, [
        { id: "item-2", name: "Renamed" },
        { id: "item-4", name: "New" },
      ]);
      assert.deepStrictEqual(changed.deleted, ["item-3"]);
    }),
  );

  it.effect("finds what commits after a later transaction did", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const { table, pull } = yield* itemsTable();
      const start = yield* pull(undefined);

      // A long transaction writes first, and commits last.
      const wrote = yield* Deferred.make<void>();
      const commit = yield* Deferred.make<void>();
      const slow = yield* Effect.gen(function* () {
        yield* sql`INSERT INTO ${sql(table)} (id, name) VALUES ('slow', 'Slow')`;
        yield* Deferred.succeed(wrote, undefined);
        yield* Deferred.await(commit);
      }).pipe(sql.withTransaction, Effect.forkChild);
      yield* Deferred.await(wrote);
      yield* sql`INSERT INTO ${sql(table)} (id, name) VALUES ('fast', 'Fast')`;

      const before = yield* pull(start.token);
      assert.deepStrictEqual(ids(before.rows), ["fast"]);

      yield* Deferred.succeed(commit, undefined);
      yield* Fiber.join(slow);
      const after = yield* pull(before.token);
      assert.deepStrictEqual(ids(after.rows), ["slow"]);
    }),
  );

  it.effect("keeps keys reused or changed straight", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const { table, pull } = yield* itemsTable(2);
      const start = yield* pull(undefined);

      // Deleted, then back: it's there, not deleted.
      yield* sql`DELETE FROM ${sql(table)} WHERE id = 'item-1'`;
      yield* sql`INSERT INTO ${sql(table)} (id, name) VALUES ('item-1', 'Back')`;
      // A changed key: the old one is gone.
      yield* sql`UPDATE ${sql(table)} SET id = 'item-9' WHERE id = 'item-2'`;
      const pulled = yield* pull(start.token);
      assert.deepStrictEqual(ids(pulled.rows), ["item-1", "item-9"]);
      assert.deepStrictEqual(pulled.deleted, ["item-2"]);
    }),
  );

  it.effect("starts over when it can't pull from a token", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const { table, pull, status } = yield* itemsTable(2);
      const start = yield* pull(undefined);
      const [here] = yield* sql<{ origin: string }>`
        SELECT snapsync.origin() AS origin
      `;
      assert.strictEqual(yield* status(start.token), "current");
      assert.strictEqual(yield* status(null), "missing");
      for (const malformed of [
        "",
        "2/1/2/1/3:4:",
        "1/x/y/1/3:4:",
        `1/${here?.origin}/3:4:`,
        // Its xmin is past its xmax.
        `1/${here?.origin}/1/9:5:`,
      ]) {
        assert.strictEqual(yield* status(malformed), "malformed", malformed);
      }
      assert.strictEqual(yield* status("1/1/1/1/3:4:"), "elsewhere");
      assert.strictEqual(
        yield* status(`1/${here?.origin}/1/999999999:999999999:`),
        "ahead",
      );
      for (const token of ["nonsense", "1/1/1/1/3:4:"]) {
        const pulled = yield* pull(token);
        assert.isTrue(pulled.complete, token);
        assert.strictEqual(pulled.rows.length, 2);
      }

      // Truncating leaves no tombstones: the table's clients start over.
      yield* sql`TRUNCATE ${sql(table)}`;
      assert.strictEqual(yield* status(start.token), "restarted");
      const after = yield* pull(start.token);
      assert.deepStrictEqual([after.complete, after.rows], [true, []]);
    }),
  );

  it.effect("forgets old tombstones; who needed them starts over", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const { table, pull, status, tokenAt } = yield* itemsTable(2);
      const start = yield* pull(undefined);
      yield* sql`DELETE FROM ${sql(table)} WHERE id = 'item-1'`;
      const latest = yield* pull(start.token);
      assert.deepStrictEqual(latest.deleted, ["item-1"]);

      const prune = (retention: string) =>
        sql<{ forgotten: string }>`
          SELECT snapsync.prune(${retention}::interval) AS forgotten
        `.pipe(Effect.map(([row]) => Number(row?.forgotten)));
      // Kept while younger than the retention.
      assert.strictEqual(yield* prune("1 hour"), 0);
      assert.isAtLeast(yield* prune("0 seconds"), 1);

      // Who hadn't pulled the delete starts over.
      const behind = yield* pull(start.token);
      assert.deepStrictEqual(
        [behind.complete, ids(behind.rows)],
        [true, ["item-2"]],
      );
      // Who had seen everything forgotten carries on. (Which clients had
      // depends on transactions anywhere in the cluster, as a snapshot's
      // xmin is the oldest running: keep tombstones longer than those run.)
      const [tracked] = yield* sql<{ horizon: string }>`
        SELECT horizon::text FROM snapsync.tables
        WHERE relation = ${table}::regclass
      `;
      const horizon = BigInt(tracked?.horizon ?? 0);
      assert.strictEqual(
        yield* status(yield* tokenAt(horizon + 1n)),
        "current",
      );
      assert.strictEqual(yield* status(yield* tokenAt(horizon)), "pruned");
    }),
  );

  it.effect("after a restore from elsewhere, everyone starts over", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const { pull, status } = yield* itemsTable(2);
      const start = yield* pull(undefined);
      const ensure = sql<{ restamped: boolean }>`
        SELECT snapsync.ensure_current() AS restamped
      `.pipe(Effect.map(([row]) => row?.restamped));
      assert.isFalse(yield* ensure);

      // As a dump restored into another database says.
      yield* sql`UPDATE snapsync.state SET database = 0`;
      assert.isTrue(yield* ensure);
      assert.isFalse(yield* ensure);
      // Tokens from before: they start over.
      assert.strictEqual(yield* status(start.token), "restarted");
      const after = yield* pull(start.token);
      assert.deepStrictEqual([after.complete, after.rows.length], [true, 2]);
    }),
  );

  it.effect("shows deletes only of tables the reader may read", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const { table, pull } = yield* itemsTable(1);
      const start = yield* pull(undefined);
      yield* sql`DELETE FROM ${sql(table)} WHERE id = 'item-1'`;
      const role = `snapsync_reader_${tables}_${Date.now()}`;
      yield* Effect.acquireRelease(sql`CREATE ROLE ${sql(role)}`, () =>
        sql`DROP OWNED BY ${sql(role)}`.pipe(
          Effect.andThen(sql`DROP ROLE ${sql(role)}`),
          Effect.orDie,
        ),
      );
      const deletedAs = Effect.gen(function* () {
        const [since] = yield* sql<{ since: string }>`
          SELECT snapsync.since(${start.token}, ${table}::regclass)::text AS since
        `;
        yield* sql`SET LOCAL ROLE ${sql(role)}`;
        return yield* sql<{ key: string }>`
          SELECT key FROM snapsync.deleted(${table}::regclass,
            ${since?.since ?? null}::pg_snapshot) AS key
        `;
      }).pipe(sql.withTransaction);
      assert.deepStrictEqual(yield* deletedAs, []);
      yield* sql`GRANT SELECT ON ${sql(table)} TO ${sql(role)}`;
      assert.deepStrictEqual(yield* deletedAs, [{ key: "item-1" }]);
    }).pipe(Effect.scoped),
  );

  it.effect("narrows pulls by the index on the xid column", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const { table, pull } = yield* itemsTable(100);
      const { token } = yield* pull(undefined);
      const plan = yield* Effect.gen(function* () {
        yield* sql`SET LOCAL enable_seqscan = off`;
        const [since] = yield* sql<{ since: string }>`
          SELECT snapsync.since(${token}, ${table}::regclass)::text AS since
        `;
        return yield* sql<{ "QUERY PLAN": string }>`
          EXPLAIN SELECT id FROM ${sql(table)}
          WHERE snapsync.unseen(xid, ${since?.since ?? null}::pg_snapshot)
        `;
      }).pipe(sql.withTransaction);
      const text = plan.map((row) => row["QUERY PLAN"]).join("\n");
      assert.include(text, "Index Cond: (xid >=");
    }),
  );

  it.effect(
    "keeps copies the same as the table under out-of-order writes",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const { table, pull, all } = yield* itemsTable(50);
        const copies = [replica({ getKey, pull }), replica({ getKey, pull })];
        yield* Effect.forEach(copies, (copy) => copy.pull);

        // Mostly a few hot rows; some new ones and some deleted.
        const write = Effect.gen(function* () {
          const n = yield* Random.nextIntBetween(1, 60);
          const hot = (yield* Random.next) < 0.5;
          const id = `item-${hot ? (n % 5) + 1 : n}`;
          const roll = yield* Random.next;
          if (roll < 0.15) {
            yield* sql`DELETE FROM ${sql(table)} WHERE id = ${id}`;
          } else {
            yield* sql`
              INSERT INTO ${sql(table)} (id, name) VALUES (${id}, ${`Written ${roll}`})
              ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
            `;
          }
        });
        const writing = yield* concurrentWriters({
          writers: 8,
          transactions: 25,
          write,
        }).pipe(Effect.forkChild);
        // Pull all along, as clients do.
        const pulling = yield* Effect.forEach(
          copies,
          (copy) => copy.pull.pipe(Effect.delay("5 millis"), Effect.forever),
          { concurrency: "unbounded", discard: true },
        ).pipe(Effect.forkChild);
        yield* Fiber.join(writing);
        yield* Fiber.interrupt(pulling);

        const now = yield* all;
        for (const copy of copies) {
          yield* copy.pull;
          assert.deepStrictEqual(
            differences({ table: now, copy: copy.rows, getKey }),
            { missing: [], extra: [], changed: [] },
          );
          assert.strictEqual(copy.stats().restarts, 0);
          assert.isAbove(copy.stats().pulls, 2);
        }
      }),
    { timeout: 60_000 },
  );
});
