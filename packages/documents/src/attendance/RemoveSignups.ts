import { Effect } from "effect";
import type { SqlClient, Statement } from "effect/sql";
import type { DocumentId } from "../Model.ts";
import type { Signup } from "../notices/Notifications.ts";

export const removeSignups = (sql: SqlClient.SqlClient, event: DocumentId) =>
  Effect.gen(function* () {
    const removed = yield* sql<Signup>`
      DELETE FROM attendees WHERE event_id = ${event}
      RETURNING id, name, email, user_issuer IS NULL AS guest, locale
    `;
    yield* sql`DELETE FROM dietary_preferences WHERE event_id = ${event}`;
    return removed;
  });

export const removeSignupsFor = (
  sql: SqlClient.SqlClient,
  events: Statement.Statement<unknown>,
) =>
  Effect.gen(function* () {
    yield* sql`DELETE FROM attendees WHERE event_id IN (${events})`;
    yield* sql`DELETE FROM dietary_preferences WHERE event_id IN (${events})`;
  });
