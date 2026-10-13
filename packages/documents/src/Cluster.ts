import * as Snapsync from "@skjera/snapsync/server";
import { Cron, Effect, Layer } from "effect";
import { ClusterCron, SingleRunner } from "effect/cluster";
import { SqlClient, type Statement } from "effect/sql";

// Work done once across server instances, and work that must survive
// restarts, run by an Effect cluster: entities (actors) whose messages are
// kept in Postgres, singletons, and cron jobs. One runner for now, in the
// server process; its tables are prefixed "cluster_".

/**
 * The cluster, on the database's SQL client. Needs `Crypto` (to hash long
 * deduplication keys).
 */
export const layer = SingleRunner.layer();

/**
 * Forgets what the cluster keeps for an entity type's entities, all but
 * those whose ids `keep` selects (one text column, in lower case): their
 * messages and the replies to them, as `MessageStorage.clearAddress` does
 * for one entity. Ids are compared in lower case: a UUID may be given in
 * capitals.
 */
export const forgetMessagesExcept = (
  entityType: string,
  keep: Statement.Fragment,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      DELETE FROM cluster_replies WHERE request_id IN (
        SELECT id FROM cluster_messages
        WHERE entity_type = ${entityType} AND lower(entity_id) NOT IN (${keep})
      )
    `;
    yield* sql`
      DELETE FROM cluster_messages
      WHERE entity_type = ${entityType} AND lower(entity_id) NOT IN (${keep})
    `;
  });

/** Forgets old sync tombstones, hourly, in one instance. */
const pruneTombstones = ClusterCron.make({
  name: "snapsync-prune",
  cron: Cron.parseUnsafe("17 * * * *"),
  execute: Effect.asVoid(Snapsync.prune()),
});

/** Cron jobs and entities, registered with the cluster. */
export const jobs = Layer.mergeAll(pruneTombstones);
