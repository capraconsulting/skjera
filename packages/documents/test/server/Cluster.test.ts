import { NodeCrypto } from "@effect/platform-node";
import { assert, layer } from "@effect/vitest";
import { Cron, Deferred, Effect, Layer, Ref, Schedule, Schema } from "effect";
import {
  ClusterCron,
  ClusterSchema,
  Entity,
  SingleRunner,
} from "effect/cluster";
import { Rpc } from "effect/rpc";
import { SqlClient } from "effect/sql";
import { TestDatabase } from "../TestDatabase.ts";

// How the Effect cluster behaves on our Postgres, for the work built on it
// (announcing in Slack, reminders): an outbox entity whose messages are
// kept in the database, deduplicated by id. Each test sends ids of its own
// run: messages one test leaves behind may be delivered during another.

const Deliver = Rpc.make("Deliver", {
  payload: { id: Schema.String },
  primaryKey: ({ id }) => id,
}).annotate(ClusterSchema.Persisted, true);

const Outbox = Entity.make("Outbox", [Deliver]);

/** A cluster on the test database, polling often. */
const cluster = SingleRunner.layer({
  shardingConfig: {
    entityMessagePollInterval: "50 millis",
    entityReplyPollInterval: "50 millis",
    entityTerminationTimeout: "200 millis",
  },
}).pipe(Layer.provide(NodeCrypto.layer));

interface Handled {
  readonly id: string;
  readonly at: "start" | "end";
}

/**
 * The outbox's handler. It notes when it starts and ends each delivery.
 * With `failures`, delivering fails that many times per id first, and is
 * retried; with `deaths`, it dies (a defect) that many times per id first;
 * with `hang`, it never finishes.
 */
const outbox = (
  log: Ref.Ref<ReadonlyArray<Handled>>,
  options: {
    readonly failures?: number;
    readonly deaths?: number;
    readonly hang?: boolean;
  } = {},
) => {
  // Counted here, as a defect restarts the entity.
  const counts = new Map<string, number>();
  const count = (key: string) => {
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    return n;
  };
  const note = (id: string, at: Handled["at"]) =>
    Ref.update(log, (all) => [...all, { id, at }]);
  return Outbox.toLayer(
    Outbox.of({
      Deliver: ({ payload }) =>
        Effect.gen(function* () {
          yield* note(payload.id, "start");
          if (count(`death/${payload.id}`) <= (options.deaths ?? 0)) {
            return yield* Effect.die("Delivering died");
          }
          // As a call to Slack might fail, and be tried again.
          yield* Effect.suspend(() =>
            count(`failure/${payload.id}`) <= (options.failures ?? 0)
              ? Effect.fail("Delivering failed")
              : Effect.void,
          ).pipe(
            Effect.retry({ schedule: Schedule.spaced("20 millis"), times: 5 }),
            Effect.orDie,
          );
          if (options.hang) yield* Effect.never;
          yield* Effect.sleep("20 millis");
          yield* note(payload.id, "end");
        }),
    }),
  );
};

/** Sends `id` to the outbox `entity`, without waiting for it. */
const send = (entity: string, id: string) =>
  Effect.gen(function* () {
    const client = yield* Outbox.client;
    yield* client(entity).Deliver({ id }, { discard: true });
  });

/** A test's run: ids of its own, and what was done with them. */
const run = Effect.gen(function* () {
  const prefix = `run-${crypto.randomUUID()}`;
  const log = yield* Ref.make<ReadonlyArray<Handled>>([]);
  const handled = Effect.map(Ref.get(log), (all) =>
    all.filter((each) => each.id.startsWith(prefix)),
  );
  return {
    log,
    id: (label: string) => `${prefix}/${label}`,
    entity: `channel-${prefix}`,
    handled,
    delivered: Effect.map(handled, (all) =>
      all.filter((each) => each.at === "end").map((each) => each.id),
    ),
  };
});

/** Waits until `check` holds, for up to a few seconds. */
const eventually = <A>(effect: Effect.Effect<A>, check: (a: A) => boolean) =>
  effect.pipe(
    Effect.filterOrFail(check, () => "not yet"),
    Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 80 }),
    Effect.orDie,
  );

/** Runs `effect` on a cluster with the outbox registered. */
const withOutbox = <A, E, R>(
  log: Ref.Ref<ReadonlyArray<Handled>>,
  effect: Effect.Effect<A, E, R>,
  options?: Parameters<typeof outbox>[1],
) =>
  effect.pipe(
    Effect.provide(outbox(log, options).pipe(Layer.provideMerge(cluster))),
  );

// Real clock: these tests talk to a real database.
layer(TestDatabase, { excludeTestServices: true })("Cluster", (it) => {
  it.effect("delivers each message once, however often it's sent", () =>
    Effect.gen(function* () {
      const { log, id, entity, delivered } = yield* run;
      yield* withOutbox(
        log,
        Effect.gen(function* () {
          yield* send(entity, id("a"));
          yield* send(entity, id("a"));
          yield* send(entity, id("b"));
          yield* eventually(delivered, (ids) => ids.length >= 2);
          yield* Effect.sleep("300 millis");
        }),
      );
      assert.deepStrictEqual(yield* delivered, [id("a"), id("b")]);
    }),
  );

  it.effect("handles one message at a time per entity, in order", () =>
    Effect.gen(function* () {
      const { log, id, entity, handled, delivered } = yield* run;
      const ids = Array.from({ length: 5 }, (_, n) => id(`m${n}`));
      yield* withOutbox(
        log,
        Effect.gen(function* () {
          for (const each of ids) yield* send(entity, each);
          yield* eventually(delivered, (done) => done.length === 5);
        }),
      );
      // start, end, start, end, ...: never two at once.
      assert.deepStrictEqual(
        yield* handled,
        ids.flatMap((each) => [
          { id: each, at: "start" as const },
          { id: each, at: "end" as const },
        ]),
      );
    }),
  );

  it.effect("retries what fails in the handler, as told", () =>
    Effect.gen(function* () {
      const { log, id, entity, delivered } = yield* run;
      yield* withOutbox(
        log,
        Effect.gen(function* () {
          yield* send(entity, id("flaky"));
          yield* eventually(delivered, (ids) => ids.length === 1);
        }),
        { failures: 2 },
      );
      assert.deepStrictEqual(yield* delivered, [id("flaky")]);
    }),
  );

  it.effect("tries a delivery that died again, after a restart", () =>
    Effect.gen(function* () {
      const { log, id, entity, handled, delivered } = yield* run;
      yield* withOutbox(
        log,
        Effect.gen(function* () {
          yield* send(entity, id("died"));
          yield* eventually(delivered, (ids) => ids.length === 1);
        }),
        { deaths: 1 },
      );
      // The defect restarts the entity, which takes the message again.
      assert.strictEqual(
        (yield* handled).filter((each) => each.at === "start").length,
        2,
      );
    }),
  );

  it.effect("waits for the next runner after dying twice in a row", () =>
    Effect.gen(function* () {
      const { log, id, entity, handled, delivered } = yield* run;
      // In effect 4.0.0, a defect in the delivery replayed after a defect
      // doesn't restart the entity again: the message stays stored,
      // unprocessed, until the next runner. (An upstream bug, it seems.
      // Should that change, so should this test.)
      yield* withOutbox(
        log,
        Effect.gen(function* () {
          yield* send(entity, id("died-twice"));
          yield* eventually(handled, (all) => all.length === 2);
          yield* Effect.sleep("1 second");
        }),
        { deaths: 2 },
      );
      assert.deepStrictEqual(yield* delivered, []);
      assert.strictEqual((yield* handled).length, 2);
      yield* withOutbox(
        log,
        eventually(delivered, (ids) => ids.length === 1),
      );
    }),
  );

  it.effect("keeps messages through a restart, mid-delivery", () =>
    Effect.gen(function* () {
      const { log, id, entity, handled, delivered } = yield* run;
      // The first runner takes the message, and stops before it's done.
      yield* withOutbox(
        log,
        Effect.gen(function* () {
          yield* send(entity, id("kept"));
          yield* eventually(handled, (all) => all.length > 0);
        }),
        { hang: true },
      );
      assert.deepStrictEqual(yield* delivered, []);
      // The next one finishes it.
      yield* withOutbox(
        log,
        eventually(delivered, (ids) => ids.length === 1),
      );
    }),
  );

  it.effect("sends from a transaction only if it commits", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const { log, id, entity, delivered } = yield* run;
      // Stored as "<entity type>/<entity id>/<tag>/<primary key>".
      const stored = (key: string) =>
        sql<{ count: string }>`
          SELECT count(*) FROM cluster_messages WHERE message_id LIKE ${`%/${key}`}
        `.pipe(
          Effect.map(([row]) => Number(row?.count)),
          Effect.orDie,
        );
      const result = yield* withOutbox(
        log,
        Effect.gen(function* () {
          yield* Effect.gen(function* () {
            yield* send(entity, id("rolled-back"));
            return yield* Effect.fail("rolled back");
          }).pipe(sql.withTransaction, Effect.ignore);
          yield* send(entity, id("committed")).pipe(sql.withTransaction);
          yield* eventually(delivered, (ids) => ids.length === 1);
          yield* Effect.sleep("300 millis");
          return {
            delivered: yield* delivered,
            stored: [
              yield* stored(id("rolled-back")),
              yield* stored(id("committed")),
            ],
          };
        }),
      );
      assert.deepStrictEqual(result, {
        delivered: [id("committed")],
        stored: [0, 1],
      });
    }),
  );

  it.effect("runs a cron job on its schedule", () =>
    Effect.gen(function* () {
      const runs = yield* Ref.make(0);
      const ran = yield* Deferred.make<void>();
      yield* Deferred.await(ran).pipe(
        Effect.timeout("5 seconds"),
        Effect.provide(
          ClusterCron.make({
            name: `every-second-${crypto.randomUUID()}`,
            cron: Cron.parseUnsafe("* * * * * *"),
            execute: Ref.updateAndGet(runs, (n) => n + 1).pipe(
              Effect.flatMap((n) =>
                n >= 2 ? Deferred.succeed(ran, undefined) : Effect.void,
              ),
            ),
          }).pipe(Layer.provideMerge(cluster)),
        ),
      );
      assert.isAtLeast(yield* Ref.get(runs), 2);
    }),
  );
});
