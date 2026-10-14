import { Clock, Cron, Effect } from "effect";
import { ClusterCron } from "effect/cluster";
import { SqlClient } from "effect/sql";
import { EventMail } from "../notices/Mail.tsx";
import * as Cluster from "../server/Cluster.ts";

// Sign-up data is kept until 30 days after its event has ended, as the
// privacy page says. A nightly job then deletes the event's signups, its
// list of dietary preferences and the emails kept for its attendees,
// deleted events too. The event itself, its content and its history stay.

/** How long sign-up data is kept after its event has ended. */
const keptFor = 30 * 24 * 60 * 60 * 1000;

/** Every day at 01:00 UTC; the zone is given, else `Cron` reads the process's. */
export const schedule = Cron.parseUnsafe("0 1 * * *", "UTC");

/**
 * Deletes the sign-up data of every event that ended more than 30 days
 * before `now`: its signups, members and guests, its dietary preferences,
 * and its mailer's stored emails. All of it or nothing.
 */
export const deleteSignups = (now: Date) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const cutoff = new Date(now.getTime() - keptFor);
    const ended = sql`SELECT id FROM events WHERE ends_at < ${cutoff}`;
    yield* Effect.gen(function* () {
      yield* sql`DELETE FROM attendees WHERE event_id IN (${ended})`;
      yield* sql`DELETE FROM dietary_preferences WHERE event_id IN (${ended})`;
      // The mailer keeps the emails of events not past the cutoff only:
      // those of events past it, or gone with their team, are forgotten.
      yield* Cluster.forgetMessagesExcept(
        EventMail.type,
        sql`SELECT id::text FROM events WHERE ends_at >= ${cutoff}`,
      );
    }).pipe(sql.withTransaction);
  }).pipe(Effect.orDie);

/** `deleteSignups`, nightly, in one instance. */
export const job = ClusterCron.make({
  name: "signup-retention",
  cron: schedule,
  execute: Effect.flatMap(Clock.currentTimeMillis, (millis) =>
    deleteSignups(new Date(millis)),
  ),
});
