import { Effect, Schedule } from "effect";
import { SqlClient } from "effect/sql";

/** Waits until every cluster message currently stored has been processed. */
export const clusterSettled = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const [row] = yield* sql<{ pending: number }>`
    SELECT count(*)::int AS pending FROM cluster_messages WHERE NOT processed
  `;
  return row?.pending ?? 0;
}).pipe(
  Effect.filterOrFail(
    (pending) => pending === 0,
    () => "not yet",
  ),
  Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 200 }),
  Effect.orDie,
);
