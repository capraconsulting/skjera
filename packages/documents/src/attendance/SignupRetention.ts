import { Clock, Cron, Effect } from "effect";
import { ClusterCron } from "effect/cluster";
import { SqlClient } from "effect/sql";
import { HubSpotEvent } from "../notices/HubSpotSync.ts";
import { EventMail } from "../notices/Mail.tsx";
import * as Cluster from "../server/Cluster.ts";

// Sign-up data is kept until 30 days after its event has ended, as the
// privacy page says. A nightly job then deletes the event's signups, its
// list of dietary preferences, the list of those noted as invited, the
// emails an organizer sent to them and the emails and HubSpot messages kept
// for its attendees, deleted events too. The
// event itself, its content and its history stay.

/** How long sign-up data is kept after its event has ended. */
const keptFor = 30 * 24 * 60 * 60 * 1000;

/** Every day at 01:00 UTC; the zone is given, else `Cron` reads the process's. */
export const schedule = Cron.parseUnsafe("0 1 * * *", "UTC");

/**
 * Deletes the sign-up data of every event that ended more than 30 days
 * before `now`: its signups, members and guests, its dietary preferences,
 * its list of those invited, the emails an organizer sent to its attendees,
 * and the emails and HubSpot messages stored for it. An event never
 * published has no row in `events`: its list goes 30 days after its draft's
 * end. All of it or nothing.
 */
export const deleteSignups = (now: Date) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const cutoff = new Date(now.getTime() - keptFor);
    const ended = sql`SELECT id FROM events WHERE ends_at < ${cutoff}`;
    yield* Effect.gen(function* () {
      yield* sql`DELETE FROM attendees WHERE event_id IN (${ended})`;
      yield* sql`DELETE FROM dietary_preferences WHERE event_id IN (${ended})`;
      yield* sql`DELETE FROM organizer_emails WHERE event_id IN (${ended})`;
      // Never published: no row in `events`, so the draft's own end counts,
      // read as `documents_summarize` reads its start. A draft with no end
      // yet has not ended.
      const endedDrafts = sql`
        SELECT d.id FROM documents d
        WHERE d.id IN (SELECT event_id FROM invitations)
          AND NOT EXISTS (SELECT 1 FROM events e WHERE e.id = d.id)
          AND zoned_instant(d.draft::jsonb->>'end') < ${cutoff}
      `;
      yield* sql`DELETE FROM invitations WHERE event_id IN (${ended}) OR event_id IN (${endedDrafts})`;
      // The mailer and the HubSpot sender keep the messages of events not
      // past the cutoff only: those of events past it, or gone with their
      // team, are forgotten.
      for (const entity of [EventMail, HubSpotEvent]) {
        yield* Cluster.forgetMessagesExcept(
          entity.type,
          sql`SELECT id::text FROM events WHERE ends_at >= ${cutoff}`,
        );
      }
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
