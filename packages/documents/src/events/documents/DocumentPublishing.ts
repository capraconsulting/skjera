import type { Identity } from "@skjera/oauth/api";
import { Effect, Schema } from "effect";
import { type SqlClient, SqlError } from "effect/sql";
import { DocumentNotFound, PublishRejected } from "../../api/errors.ts";
import { refused } from "../../api/Problems.ts";
import {
  type DocumentId,
  type Heads,
  NoticeChanged,
  type Publication,
  type PublishingNotice,
} from "../../Model.ts";
import {
  type ChangeNotice,
  type Signup,
  signupColumns,
  tell,
} from "../../notices/Notifications.ts";
import { pgCode } from "../../server/PostgresError.ts";
import {
  cantPublish,
  EventContent,
  eventChecks,
  eventToPublish,
} from "../ContentTypes.ts";
import { publishEvent } from "./EventPublishing.ts";
import {
  changeToTell,
  publishingAnswer,
  samePublishingNotice,
  type WhenAndWhere,
} from "./PublishingNotifications.ts";

class NoticePreview<N> {
  readonly _tag = "NoticePreview";
  readonly notice: N;
  constructor(notice: N) {
    this.notice = notice;
  }
}
class NoticeMismatch<N> {
  readonly _tag = "NoticeMismatch";
  readonly notice: N;
  constructor(notice: N) {
    this.notice = notice;
  }
}

type Dependencies = {
  readonly sql: SqlClient.SqlClient;
  readonly notifications: {
    readonly eventChanged: (notice: ChangeNotice) => Effect.Effect<void>;
  };
  readonly announcements: {
    readonly eventPublished: (id: DocumentId) => Effect.Effect<void>;
  };
  readonly salesEvents: {
    readonly published: (id: DocumentId) => Effect.Effect<void>;
  };
  readonly rememberName: (
    user: Identity,
  ) => Effect.Effect<void, SqlError.SqlError>;
  readonly typeOf: (id: DocumentId) => Effect.Effect<unknown, DocumentNotFound>;
  readonly toPublication: (row: {
    published_heads: Heads;
    published_at: Date;
    first_published_at: Date;
  }) => Publication;
};

export const documentPublishing = ({
  sql,
  notifications,
  announcements,
  salesEvents,
  rememberName,
  typeOf,
  toPublication,
}: Dependencies) => {
  const publishRow = (id: DocumentId, heads: Heads, user: Identity) =>
    Effect.gen(function* () {
      yield* sql`SELECT id FROM documents WHERE id = ${id} FOR UPDATE`;
      const [before] = yield* sql<
        WhenAndWhere & {
          readonly sales_event: boolean;
          readonly off_site: boolean;
        }
      >`
        SELECT starts_at, ends_at, place, sales_event,
          deleted_at IS NOT NULL AS off_site
        FROM events WHERE id = ${id} FOR UPDATE
      `;
      const rows = yield* publishEvent(sql, id, heads, user, user);
      return { before, rows, after: rows[0] };
    });

  const publishDocument = (
    id: DocumentId,
    heads: Heads,
    user: Identity,
    confirmed?: PublishingNotice,
  ) =>
    Effect.gen(function* () {
      const { before, rows, after } = yield* publishRow(id, heads, user);
      const signups = yield* sql<Signup>`
          SELECT ${signupColumns(sql)} FROM attendees WHERE event_id = ${id}
        `;
      const answer = publishingAnswer(before, after, signups);
      if (confirmed !== undefined && !samePublishingNotice(confirmed, answer)) {
        return yield* Effect.fail(new NoticeMismatch(answer));
      }
      if (after !== undefined) {
        yield* rememberName(user);
      }
      // Published for the first time: the channel is told, once.
      if (before === undefined && after !== undefined) {
        yield* announcements.eventPublished(id);
      }
      const change = changeToTell(before, after);
      // Moved, or somewhere else: its attendees are told, in one
      // email, and get the new time and place for their calendars.
      if (before !== undefined && after !== undefined && change !== null) {
        yield* tell(signups, (attendee) =>
          notifications.eventChanged({
            event: id,
            attendee,
            version: String(after.published_at.getTime()),
            ...(change.moved
              ? {
                  previously: {
                    startsAt: before.starts_at.toISOString(),
                    endsAt: before.ends_at.toISOString(),
                  },
                }
              : {}),
            ...(change.newPlace ? { previousPlace: before.place ?? "" } : {}),
          }),
        );
      }
      // HubSpot reads the prior off-site state before it is cleared.
      if (after !== undefined) {
        yield* salesEvents.published(id);
      }
      // Unpublished before: back on the site. Never a document deleted
      // meanwhile.
      yield* sql`
          UPDATE events e SET deleted_at = NULL
          FROM documents d
          WHERE e.id = ${id} AND d.id = e.id
            AND e.deleted_at IS NOT NULL AND d.deleted_at IS NULL
        `;
      return rows;
    }).pipe(
      sql.withTransaction,
      Effect.catchTag("NoticeMismatch", ({ notice }) =>
        Effect.succeed(new NoticeChanged({ notice })),
      ),
    );

  const unknownVersion = (error: SqlError.SqlError) =>
    pgCode(error) === "22023"
      ? Effect.fail(new PublishRejected(refused({ _tag: "UnknownVersion" })))
      : Effect.die(error);

  const publishable = Effect.fnUntraced(function* (
    id: DocumentId,
    heads: Heads,
  ) {
    yield* typeOf(id);
    const [version] = yield* sql<{ content: unknown }>`
      SELECT automerge_to_jsonb(draft, ${heads}::text[]) AS content
      FROM documents WHERE id = ${id}
    `.pipe(Effect.catchIf(SqlError.isSqlError, unknownVersion));
    const content = yield* Schema.decodeUnknownEffect(EventContent)(
      version?.content,
    ).pipe(Effect.orDie);
    const missing = cantPublish(
      { toPublish: eventToPublish, checks: eventChecks },
      content,
    );
    if (missing !== null) {
      return yield* new PublishRejected(refused(missing));
    }
  });

  const publishingNotice = Effect.fn("Documents.publishingNotice")(function* (
    id: DocumentId,
    heads: Heads,
    user: Identity,
  ) {
    yield* publishable(id, heads);
    return yield* Effect.gen(function* () {
      const { before, after } = yield* publishRow(id, heads, user);
      if (after === undefined) return yield* new DocumentNotFound({ id });
      const signups = yield* sql<Signup>`
          SELECT ${signupColumns(sql)} FROM attendees WHERE event_id = ${id}
        `;
      return yield* Effect.fail(
        new NoticePreview(publishingAnswer(before, after, signups)),
      );
    }).pipe(
      sql.withTransaction,
      Effect.catchTag("NoticePreview", ({ notice }) => Effect.succeed(notice)),
      Effect.catchIf(SqlError.isSqlError, unknownVersion),
    );
  });

  const publishAction = Effect.fn("Documents.publish")(function* (
    id: DocumentId,
    heads: Heads,
    user: Identity,
    confirmed?: PublishingNotice,
  ) {
    yield* publishable(id, heads);

    const published = yield* publishDocument(id, heads, user, confirmed).pipe(
      Effect.catchIf(SqlError.isSqlError, unknownVersion),
    );
    if (published instanceof NoticeChanged) return published;
    const [row] = published;
    if (row === undefined) {
      return yield* new DocumentNotFound({ id });
    }
    return toPublication(row);
  }, Effect.uninterruptible);

  const publish = (id: DocumentId, heads: Heads, user: Identity) =>
    publishAction(id, heads, user).pipe(
      Effect.flatMap((result) =>
        result instanceof NoticeChanged
          ? Effect.die(result)
          : Effect.succeed(result),
      ),
    );
  const publishConfirmed = (
    id: DocumentId,
    heads: Heads,
    user: Identity,
    confirmed: PublishingNotice,
  ) => publishAction(id, heads, user, confirmed);

  return { publish, publishConfirmed, publishingNotice };
};
