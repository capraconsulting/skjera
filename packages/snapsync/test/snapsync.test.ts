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

const getKey = (item: Item) => item.id;
const ids = (items: ReadonlyArray<Item>) => items.map((item) => item.id);

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
    const pull = (since: Token | undefined, pageSize?: number) =>
      Server.pull({
        table,
        since,
        getKey,
        load: (keys) =>
          sql<Item>`
            SELECT id, name FROM ${sql(table)} WHERE id = ANY(${keys}) ORDER BY id
          `,
        ...(pageSize === undefined ? {} : { pageSize }),
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

  it.effect("pulls in pages; starting over, all pages replace the copy", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const { table, pull, all } = yield* itemsTable(25);
      const first = yield* pull(undefined, 10);
      assert.deepStrictEqual(
        [first.complete, first.more, first.rows.length],
        [true, true, 10],
      );
      const copy = replica({ getKey, pull: (since) => pull(since, 10) });
      yield* copy.pull;
      assert.deepStrictEqual(copy.stats(), { pulls: 1, pages: 3, restarts: 0 });
      assert.strictEqual(copy.rows.size, 25);

      // Changes come in pages too.
      yield* sql`UPDATE ${sql(table)} SET name = 'Changed' WHERE id <= 'item-20'`;
      yield* sql`DELETE FROM ${sql(table)} WHERE id = 'item-21'`;
      yield* copy.pull;
      assert.deepStrictEqual(copy.stats(), { pulls: 2, pages: 5, restarts: 0 });
      assert.deepStrictEqual(
        differences({ table: yield* all, copy: copy.rows, getKey }),
        { missing: [], extra: [], changed: [] },
      );
    }),
  );

  it.effect("pages on through changes made between pages", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const { table, pull, all } = yield* itemsTable();
      // A long transaction writes first, and commits only after the first
      // page: its id is below those of the page.
      const wrote = yield* Deferred.make<void>();
      const commit = yield* Deferred.make<void>();
      const slow = yield* Effect.gen(function* () {
        yield* sql`INSERT INTO ${sql(table)} (id, name) VALUES ('slow', 'Slow')`;
        yield* Deferred.succeed(wrote, undefined);
        yield* Deferred.await(commit);
      }).pipe(sql.withTransaction, Effect.forkChild);
      yield* Deferred.await(wrote);
      // Each in a transaction of its own, so pages end mid-way through ids.
      for (let n = 1; n <= 12; n++) {
        yield* sql`INSERT INTO ${sql(table)} (id, name) VALUES (${`item-${n}`}, 'New')`;
      }

      const page = yield* pull(undefined, 5);
      assert.isTrue(page.more);
      yield* Deferred.succeed(commit, undefined);
      yield* Fiber.join(slow);
      // Already pulled, not yet pulled, and new.
      yield* sql`UPDATE ${sql(table)} SET name = 'Changed' WHERE id = ${page.rows[0]?.id ?? ""}`;
      yield* sql`DELETE FROM ${sql(table)} WHERE id = 'item-12'`;
      yield* sql`INSERT INTO ${sql(table)} (id, name) VALUES ('later', 'Later')`;

      const copy = new Map(page.rows.map((row) => [row.id, row]));
      let token = page.token;
      for (let more: boolean = page.more; more; ) {
        const next = yield* pull(token, 5);
        assert.isFalse(next.complete);
        for (const row of next.rows) copy.set(row.id, row);
        for (const key of next.deleted) copy.delete(key);
        token = next.token;
        more = next.more;
      }
      assert.deepStrictEqual(differences({ table: yield* all, copy, getKey }), {
        missing: [],
        extra: [],
        changed: [],
      });
      assert.isTrue(copy.has("slow"));
    }),
  );

  it.effect("keeps a key deleted and inserted again at once", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const { table, pull } = yield* itemsTable(1);
      const start = yield* pull(undefined);
      // One deletes it and holds on; meanwhile another inserts it again,
      // waiting for the first to commit.
      const deleted = yield* Deferred.make<void>();
      const commit = yield* Deferred.make<void>();
      const deleting = yield* Effect.gen(function* () {
        yield* sql`DELETE FROM ${sql(table)} WHERE id = 'item-1'`;
        yield* Deferred.succeed(deleted, undefined);
        yield* Deferred.await(commit);
      }).pipe(sql.withTransaction, Effect.forkChild);
      yield* Deferred.await(deleted);
      const inserting = yield* sql`
        INSERT INTO ${sql(table)} (id, name) VALUES ('item-1', 'Again')
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
      `.pipe(Effect.forkChild);
      yield* Effect.sleep("100 millis");
      yield* Deferred.succeed(commit, undefined);
      yield* Fiber.join(deleting);
      yield* Fiber.join(inserting);

      const copy = replica({ getKey, pull });
      yield* copy.pull;
      const after = yield* pull(start.token);
      assert.deepStrictEqual(
        [after.rows, after.deleted],
        [[{ id: "item-1", name: "Again" }], []],
      );
    }),
  );

  it.effect("keeps a key a REPEATABLE READ writer inserts again", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const { table, pull } = yield* itemsTable(1);
      const copy = replica({ getKey, pull });
      yield* copy.pull;
      // The inserting writer's snapshot is from before the delete commits,
      // so even after waiting for it, it can't see the tombstone to clear.
      const deleted = yield* Deferred.make<void>();
      const commit = yield* Deferred.make<void>();
      const snapshotTaken = yield* Deferred.make<void>();
      const deleting = yield* Effect.gen(function* () {
        yield* sql`DELETE FROM ${sql(table)} WHERE id = 'item-1'`;
        yield* Deferred.succeed(deleted, undefined);
        yield* Deferred.await(commit);
      }).pipe(sql.withTransaction, Effect.forkChild);
      yield* Deferred.await(deleted);
      const inserting = yield* Effect.gen(function* () {
        yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
        yield* sql`SELECT 1`;
        yield* Deferred.succeed(snapshotTaken, undefined);
        yield* sql`
          INSERT INTO ${sql(table)} (id, name) VALUES ('item-1', 'Again')
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
        `;
      }).pipe(sql.withTransaction, Effect.forkChild);
      yield* Deferred.await(snapshotTaken);
      yield* Effect.sleep("100 millis");
      yield* Deferred.succeed(commit, undefined);
      yield* Fiber.join(deleting);
      yield* Fiber.join(inserting);

      // The tombstone stays behind; pulls skip it, as the key is there.
      const [lingering] = yield* sql<{ count: string }>`
        SELECT count(*) FROM snapsync.tombstones
        WHERE relation = ${table}::regclass AND key = 'item-1'
      `;
      assert.strictEqual(Number(lingering?.count), 1);
      yield* copy.pull;
      assert.deepStrictEqual(copy.rows.get("item-1"), {
        id: "item-1",
        name: "Again",
      });
      // Deleted for real later, it goes.
      yield* sql`DELETE FROM ${sql(table)} WHERE id = 'item-1'`;
      yield* copy.pull;
      assert.isFalse(copy.rows.has("item-1"));
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

  for (const isolation of ["read committed", "repeatable read"] as const) {
    it.effect(
      `keeps copies the same as keys are deleted and inserted again (${isolation})`,
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const { table, pull, all } = yield* itemsTable(3);
          const copies = [
            replica({ getKey, pull }),
            replica({ getKey, pull: (since) => pull(since, 2) }),
          ];
          // One that's away meanwhile, and catches up at the end.
          const behind = replica({ getKey, pull });
          yield* Effect.forEach([...copies, behind], (copy) => copy.pull);

          // Three keys, deleted and inserted again by overlapping writers.
          const write = Effect.gen(function* () {
            const id = `item-${yield* Random.nextIntBetween(1, 4)}`;
            if ((yield* Random.next) < 0.5) {
              yield* sql`DELETE FROM ${sql(table)} WHERE id = ${id}`;
            } else {
              yield* sql`
                INSERT INTO ${sql(table)} (id, name) VALUES (${id}, ${`Written ${yield* Random.next}`})
                ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
              `;
            }
          });
          const writing = yield* concurrentWriters({
            writers: 10,
            transactions: 30,
            write,
            isolation,
            rollbackRate: 0,
          }).pipe(Effect.forkChild);
          const pulling = yield* Effect.forEach(
            copies,
            (copy) => copy.pull.pipe(Effect.delay("2 millis"), Effect.forever),
            { concurrency: "unbounded", discard: true },
          ).pipe(Effect.forkChild);
          const committed = yield* Fiber.join(writing);
          yield* Fiber.interrupt(pulling);
          assert.isAbove(committed, 50, "enough writers got through");

          const now = yield* all;
          for (const copy of [...copies, behind]) {
            yield* copy.pull;
            assert.deepStrictEqual(
              differences({ table: now, copy: copy.rows, getKey }),
              { missing: [], extra: [], changed: [] },
            );
          }
          // Writers that see what committed before them (READ COMMITTED)
          // leave no tombstone of a key that's there.
          if (isolation === "read committed") {
            const [left] = yield* sql<{ count: string }>`
              SELECT count(*) FROM snapsync.tombstones t
              JOIN ${sql(table)} r ON r.id = t.key
              WHERE t.relation = ${table}::regclass
            `;
            assert.strictEqual(Number(left?.count), 0);
          }
        }),
      { timeout: 60_000 },
    );
  }

  it.effect(
    "keeps copies the same as the table under out-of-order writes",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const { table, pull, all } = yield* itemsTable(50);
        // One copy pulling in small pages, so pages end mid-transaction.
        const copies = [
          replica({ getKey, pull }),
          replica({ getKey, pull: (since) => pull(since, 7) }),
        ];
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
