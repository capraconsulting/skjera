import type { Identity } from "@skjera/oauth/api";
import { Effect } from "effect";
import { type SqlClient, SqlError, type Statement } from "effect/sql";
import { DocumentNotFound } from "../../api/errors.ts";
import { removeSignups } from "../../attendance/RemoveSignups.ts";
import {
  CancellingNotice,
  type DocumentId,
  NoticeChanged,
} from "../../Model.ts";
import {
  type Notice,
  recipients,
  type Signup,
  signupColumns,
  tell,
} from "../../notices/Notifications.ts";
import { sameCancellingNotice } from "./PublishingNotifications.ts";

class NoticeMismatch<N> {
  readonly _tag = "NoticeMismatch";
  readonly notice: N;
  constructor(notice: N) {
    this.notice = notice;
  }
}

type Dependencies = {
  readonly sql: SqlClient.SqlClient;
  readonly upcoming: Statement.Fragment;
  readonly notifications: {
    readonly eventCancelled: (notice: Notice) => Effect.Effect<void>;
  };
  readonly salesEvents: {
    readonly cancelled: (id: DocumentId) => Effect.Effect<void>;
  };
};

export const documentDeletion = ({
  sql,
  upcoming,
  notifications,
  salesEvents,
}: Dependencies) => {
  const cancellingAnswer = Effect.fnUntraced(function* (id: DocumentId) {
    const [document] = yield* sql`
      SELECT id FROM documents WHERE id = ${id} AND deleted_at IS NULL
    `;
    if (document === undefined) return yield* new DocumentNotFound({ id });
    const [event] = yield* sql<{ upcoming: boolean }>`
      SELECT ${upcoming} AS upcoming FROM events WHERE id = ${id}
    `;
    if (!event?.upcoming) return new CancellingNotice({ told: 0 });
    const signups = yield* sql<Signup>`
      SELECT ${signupColumns(sql)} FROM attendees WHERE event_id = ${id}
    `;
    return new CancellingNotice({ told: recipients(signups).length });
  });

  const cancellingNotice = Effect.fn("Documents.cancellingNotice")(
    (id: DocumentId) =>
      cancellingAnswer(id).pipe(
        Effect.catchIf(SqlError.isSqlError, Effect.die),
      ),
  );

  const unpublish = Effect.fn("Documents.unpublish")(function* (
    id: DocumentId,
    confirmed?: CancellingNotice,
  ) {
    const result = yield* Effect.gen(function* () {
      // The document first, then the event: the order `delete` locks them in.
      const [document] = yield* sql`
        SELECT id FROM documents WHERE id = ${id} AND deleted_at IS NULL FOR UPDATE
      `;
      if (document === undefined) return false;
      // Off the site as a deleted event is, everywhere `events.deleted_at`
      // is read; the draft stays, and publishing clears it.
      const [event] = yield* sql<{ upcoming: boolean }>`
        UPDATE events SET deleted_at = now()
        WHERE id = ${id} AND deleted_at IS NULL
        RETURNING ${upcoming} AS upcoming
      `;
      if (confirmed !== undefined) {
        const signups = event?.upcoming
          ? yield* sql<Signup>`SELECT ${signupColumns(sql)} FROM attendees WHERE event_id = ${id}`
          : [];
        const answer = new CancellingNotice({
          told: event?.upcoming ? recipients(signups).length : 0,
        });
        if (!sameCancellingNotice(confirmed, answer)) {
          return yield* Effect.fail(new NoticeMismatch(answer));
        }
      }
      // Signed up for what won't happen now: cancelled, in calendars too,
      // and removed, so sign-up starts empty when it's published again.
      if (event?.upcoming) {
        const removed = yield* removeSignups(sql, id);
        yield* tell(removed, (attendee) =>
          notifications.eventCancelled({ event: id, attendee }),
        );
        yield* salesEvents.cancelled(id);
      }
      return true as const;
    }).pipe(
      sql.withTransaction,
      Effect.catchTag("NoticeMismatch", ({ notice }) =>
        Effect.succeed(new NoticeChanged({ notice })),
      ),
      Effect.orDie,
    );
    if (result instanceof NoticeChanged) return result;
    if (!result) {
      return yield* new DocumentNotFound({ id });
    }
  }, Effect.uninterruptible);

  const deleteDocument = Effect.fn("Documents.delete")(function* (
    id: DocumentId,
    user: Identity,
    confirmed?: CancellingNotice,
  ) {
    const result = yield* Effect.gen(function* () {
      const deleted = yield* sql`
        UPDATE documents SET deleted_at = now(),
          deleted_by_issuer = ${user.issuer}, deleted_by_subject = ${user.subject}
        WHERE id = ${id} AND deleted_at IS NULL
        RETURNING id
      `;
      if (deleted.length === 0) return false;
      const [event] = yield* sql<{ upcoming: boolean }>`
        UPDATE events SET deleted_at = now() WHERE id = ${id}
        RETURNING ${upcoming} AS upcoming
      `;
      if (confirmed !== undefined) {
        const signups = event?.upcoming
          ? yield* sql<Signup>`SELECT ${signupColumns(sql)} FROM attendees WHERE event_id = ${id}`
          : [];
        const answer = new CancellingNotice({
          told: event?.upcoming ? recipients(signups).length : 0,
        });
        if (!sameCancellingNotice(confirmed, answer)) {
          return yield* Effect.fail(new NoticeMismatch(answer));
        }
      }
      // Signed up for what won't happen now: cancelled, in calendars too.
      if (event?.upcoming) {
        const signups = yield* sql<Signup>`
          SELECT ${signupColumns(sql)}
          FROM attendees WHERE event_id = ${id}
        `;
        yield* tell(signups, (attendee) =>
          notifications.eventCancelled({ event: id, attendee }),
        );
        yield* salesEvents.cancelled(id);
      }
      yield* removeSignups(sql, id);
      return true as const;
    }).pipe(
      sql.withTransaction,
      Effect.catchTag("NoticeMismatch", ({ notice }) =>
        Effect.succeed(new NoticeChanged({ notice })),
      ),
      Effect.orDie,
    );
    if (result instanceof NoticeChanged) return result;
    if (!result) {
      return yield* new DocumentNotFound({ id });
    }
  }, Effect.uninterruptible);

  return { cancellingNotice, unpublish, deleteDocument };
};
