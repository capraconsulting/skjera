import * as Snapsync from "@skjera/snapsync/server";
import { Cron, Effect, Layer } from "effect";
import { ClusterCron, SingleRunner } from "effect/cluster";

// Work done once across server instances, and work that must survive
// restarts, run by an Effect cluster: entities (actors) whose messages are
// kept in Postgres, singletons, and cron jobs. One runner for now, in the
// server process; its tables are prefixed "cluster_".

/**
 * The cluster, on the database's SQL client. Needs `Crypto` (to hash long
 * deduplication keys).
 */
export const layer = SingleRunner.layer();

/** Forgets old sync tombstones, hourly, in one instance. */
const pruneTombstones = ClusterCron.make({
  name: "snapsync-prune",
  cron: Cron.parseUnsafe("17 * * * *"),
  execute: Effect.asVoid(Snapsync.prune()),
});

/** Cron jobs and entities, registered with the cluster. */
export const jobs = Layer.mergeAll(pruneTombstones);
