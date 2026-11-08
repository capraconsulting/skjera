import { Clock, Cron, Effect } from "effect";
import { ClusterCron } from "effect/cluster";
import { SqlClient } from "effect/sql";
import { type DocumentId, SiteSettings } from "../Model.ts";
import {
  Notifications,
  type Signup,
  signupColumns,
  tell,
} from "./Notifications.ts";

/** Every day at 07:05 UTC; the zone is given, else `Cron` reads the process's. */
export const reminderSchedule = Cron.parseUnsafe("5 7 * * *", "UTC");

/**
 * Reminds everyone signed up for events starting on the next calendar day
 * in Norway, through each event's mailer: once for each time the event
 * starts (so moving it to another day reminds them again).
 */
export const sendReminders = (now: Date) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const notifications = yield* Notifications;
    const { timeZone } = yield* SiteSettings;
    const due = yield* sql<
      Signup & { readonly event_id: string; readonly starts_at: Date }
    >`
      SELECT ${signupColumns(sql, "a")},
        e.id AS event_id, e.starts_at
      FROM events e JOIN attendees a ON a.event_id = e.id
      WHERE e.send_reminders AND e.deleted_at IS NULL AND a.email IS NOT NULL
        AND e.starts_at >= ((${now}::timestamptz AT TIME ZONE ${timeZone})::date + 1)::timestamp
          AT TIME ZONE ${timeZone}
        AND e.starts_at < ((${now}::timestamptz AT TIME ZONE ${timeZone})::date + 2)::timestamp
          AT TIME ZONE ${timeZone}
    `;
    yield* Effect.forEach(
      due,
      ({ event_id, starts_at, ...signup }) =>
        tell([signup], (attendee) =>
          notifications.reminder({
            event: event_id as DocumentId,
            attendee,
            version: String(starts_at.getTime()),
          }),
        ),
      { discard: true },
    );
  }).pipe(Effect.orDie);

/** `sendReminders`, daily, in one instance. */
export const reminders = ClusterCron.make({
  // Kept: the run already queued is taken by the same entity.
  name: "event-reminders",
  cron: reminderSchedule,
  execute: Effect.flatMap(Clock.currentTimeMillis, (millis) =>
    sendReminders(new Date(millis)),
  ),
});
