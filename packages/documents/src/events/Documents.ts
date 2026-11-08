import * as A from "@automerge/automerge";
import { type Identity, nameOf } from "@skjera/oauth/api";
import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlError } from "effect/sql";
import {
  ActorNotAllowed,
  DocumentNotFound,
  InvalidChanges,
  InvalidContent,
  MoveRejected,
  PublishRejected,
  RestoreRejected,
  TeamNotFound,
} from "../api/errors.ts";
import { refused } from "../api/Problems.ts";
import { removeSignups } from "../attendance/RemoveSignups.ts";
import {
  CancellingNotice,
  type DocumentId,
  type Heads,
  type HistoryEntry,
  isVersion,
  NoticeChanged,
  Publication,
  type PublishingNotice,
  type TeamId,
} from "../Model.ts";
import { Announcements } from "../notices/Announcements.ts";
import {
  Notifications,
  recipients,
  type Signup,
  signupColumns,
  tell,
} from "../notices/Notifications.ts";
import { SalesEvents } from "../notices/SalesEvents.ts";
import { pgCode, pgMessage } from "../server/PostgresError.ts";
import {
  type ContentTypeName,
  cantPublish,
  contentTypes,
  type EventContent,
} from "./ContentTypes.ts";
import {
  copyContent,
  discardedMessage,
  restoredMessage,
  restorePublished,
  sameContent,
  sameContentAs,
} from "./DiscardChanges.ts";
import { applyServerChange } from "./DocumentChange.ts";
import { publishEvent } from "./EventPublishing.ts";
import { readHistory } from "./History.ts";
import {
  changeToTell,
  publishingAnswer,
  sameCancellingNotice,
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

export interface DocumentSnapshot {
  readonly id: DocumentId;
  readonly type: ContentTypeName;
  readonly teamId: TeamId;
  readonly heads: Heads;
  /** An Automerge save of the draft, for `Automerge.load`. */
  readonly draft: Uint8Array;
}

/**
 * Drafts stored with pg_automerge. Postgres is the source of truth: every
 * write is a merge into the stored draft, so the service keeps no state and
 * any number of backends can serve the same document.
 */
export class Documents extends Context.Service<
  Documents,
  {
    /**
     * Creates an empty document, with `id` if given. Creating it again with
     * the same id does nothing, so a client can safely retry.
     */
    readonly create: (
      type: ContentTypeName,
      team: TeamId,
      author: Identity,
      id?: DocumentId,
    ) => Effect.Effect<DocumentId, TeamNotFound>;
    /**
     * Makes a new, never-published document in the source's team with the
     * content of its draft, and none of its history, attendees or
     * invitations. Copying again with the same `id` does nothing, so a client
     * can safely retry.
     */
    readonly copy: (
      source: DocumentId,
      id: DocumentId,
      author: Identity,
    ) => Effect.Effect<DocumentId, DocumentNotFound>;
    /**
     * Moves a document to another team, while it has never been published:
     * refused once it has, also after it is unpublished.
     */
    readonly move: (
      id: DocumentId,
      team: TeamId,
    ) => Effect.Effect<void, DocumentNotFound | TeamNotFound | MoveRejected>;
    readonly get: (
      id: DocumentId,
    ) => Effect.Effect<DocumentSnapshot, DocumentNotFound>;
    /**
     * What a replica at `heads` is missing, as change chunks for
     * `Automerge.loadIncremental`, and the draft's heads they lead up to.
     */
    readonly changesSince: (
      id: DocumentId,
      heads: Heads,
    ) => Effect.Effect<
      { readonly changes: Uint8Array; readonly heads: Heads },
      DocumentNotFound
    >;
    /**
     * Merges changes into the draft, after checking they come from the
     * sender's own actor ids and leave the draft valid for its content type.
     * An actor id belongs to the first user to send changes with it: every
     * editor session makes changes under a fresh, random one. Returns the new
     * heads.
     */
    readonly applyChanges: (
      id: DocumentId,
      changes: ReadonlyArray<Uint8Array>,
      user: Identity,
    ) => Effect.Effect<
      Heads,
      DocumentNotFound | InvalidChanges | ActorNotAllowed | InvalidContent
    >;
    /** Publishes the draft as it was at `heads`, the version the user saw. */
    readonly publish: (
      id: DocumentId,
      heads: Heads,
      user: Identity,
    ) => Effect.Effect<Publication, DocumentNotFound | PublishRejected>;
    readonly publishConfirmed: (
      id: DocumentId,
      heads: Heads,
      user: Identity,
      confirmed: PublishingNotice,
    ) => Effect.Effect<
      Publication | NoticeChanged,
      DocumentNotFound | PublishRejected
    >;
    readonly publishingNotice: (
      id: DocumentId,
      heads: Heads,
      user: Identity,
    ) => Effect.Effect<PublishingNotice, DocumentNotFound | PublishRejected>;
    readonly cancellingNotice: (
      id: DocumentId,
    ) => Effect.Effect<CancellingNotice, DocumentNotFound>;
    /**
     * Takes the published version off the site and keeps the draft. When the
     * event hasn't ended, its signups are removed and told it's cancelled.
     * Not published, or unpublished already: nothing to do.
     */
    readonly unpublish: (
      id: DocumentId,
      confirmed?: CancellingNotice,
    ) => Effect.Effect<undefined | NoticeChanged, DocumentNotFound>;
    /**
     * Makes the draft the published version again, in every field, and
     * publishes it at its new heads in the name of whoever published last.
     * Nobody is emailed. Not published: nothing to discard. The change is
     * the user's in the history.
     */
    readonly discardChanges: (
      id: DocumentId,
      user: Identity,
    ) => Effect.Effect<void, DocumentNotFound>;
    /**
     * The document's versions, newest first: who changed it and when, with
     * each publishing an entry of its own. Changes one person made within
     * ten minutes of each other are one entry.
     */
    readonly history: (
      id: DocumentId,
    ) => Effect.Effect<ReadonlyArray<HistoryEntry>, DocumentNotFound>;
    /**
     * Makes the draft equal to its version at `heads` in every field, by one
     * change on top of the draft as it is, which the history shows as the
     * user's restoring. Publishes nothing and tells nobody.
     */
    readonly restore: (
      id: DocumentId,
      heads: Heads,
      user: Identity,
    ) => Effect.Effect<void, DocumentNotFound | RestoreRejected>;
    /**
     * Deletes the document, taking its published version off the site. It's
     * kept, marked deleted. An event's attendees are told it's cancelled,
     * unless it's over.
     */
    readonly delete: (
      id: DocumentId,
      user: Identity,
      confirmed?: CancellingNotice,
    ) => Effect.Effect<undefined | NoticeChanged, DocumentNotFound>;
  }
>()("@skjera/documents/Documents") {
  static readonly layer = Layer.effect(
    Documents,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const notifications = yield* Notifications;
      const announcements = yield* Announcements;
      const salesEvents = yield* SalesEvents;

      // Writes run to their end, even if the client that asked goes away.
      const create = Effect.fn("Documents.create")(function* (
        type: ContentTypeName,
        team: TeamId,
        author: Identity,
        id?: DocumentId,
      ) {
        // The initial state gets an actor id of its own, which no editor
        // will ever use.
        const draft = A.save(A.from({ ...contentTypes[type].initial }));
        const [row] = yield* sql<{ id: DocumentId }>`
          INSERT INTO documents (id, type, team_id, draft, created_by_issuer, created_by_subject)
          VALUES (coalesce(${id ?? null}::uuid, uuidv7()), ${type}, ${team},
            ${draft}::bytea, ${author.issuer}, ${author.subject})
          ON CONFLICT (id) DO NOTHING
          RETURNING id
        `.pipe(
          Effect.catchIf(SqlError.isSqlError, (error) =>
            pgCode(error) === "23503"
              ? Effect.fail(new TeamNotFound({ id: team }))
              : Effect.die(error),
          ),
        );
        if (row !== undefined) {
          yield* rememberName(author).pipe(Effect.orDie);
          return row.id;
        }
        // Created before, by an earlier try.
        if (id !== undefined) return id;
        return yield* Effect.die("INSERT returned no row");
      }, Effect.uninterruptible);

      const rememberName = Effect.fnUntraced(function* (user: Identity) {
        const [schema] = yield* sql<{ exists: boolean }>`
          SELECT to_regclass('people') IS NOT NULL AS "exists"
        `;
        if (!schema?.exists) return;
        yield* sql`
          INSERT INTO people (issuer, subject, name)
          VALUES (${user.issuer}, ${user.subject}, ${nameOf(user)})
          ON CONFLICT (issuer, subject) DO UPDATE
            SET name = EXCLUDED.name, updated_at = now()
        `;
      });

      // The user behind an actor id the server made a change under.
      const claimActor = (id: DocumentId, actor: string, user: Identity) =>
        sql`
          INSERT INTO document_actors (document_id, actor, user_issuer, user_subject)
          VALUES (${id}, ${actor}, ${user.issuer}, ${user.subject})
          ON CONFLICT (document_id, actor) DO NOTHING
        `;

      const get = Effect.fn("Documents.get")(function* (id: DocumentId) {
        const [row] = yield* sql<{
          type: ContentTypeName;
          team_id: TeamId;
          heads: Heads;
          draft: Uint8Array;
        }>`
          SELECT type, team_id, automerge_heads(draft) AS heads, draft::bytea AS draft
          FROM documents WHERE id = ${id} AND deleted_at IS NULL
        `.pipe(Effect.orDie);
        if (row === undefined) {
          return yield* new DocumentNotFound({ id });
        }
        return {
          id,
          type: row.type,
          teamId: row.team_id,
          heads: row.heads,
          draft: row.draft,
        } satisfies DocumentSnapshot;
      });

      const copy = Effect.fn("Documents.copy")(function* (
        source: DocumentId,
        id: DocumentId,
        author: Identity,
      ) {
        const [row] = yield* sql<{
          type: ContentTypeName;
          team_id: TeamId;
          draft: Uint8Array;
        }>`
          SELECT type, team_id, draft::bytea AS draft
          FROM documents WHERE id = ${source} AND deleted_at IS NULL
        `.pipe(Effect.orDie);
        if (row === undefined) {
          return yield* new DocumentNotFound({ id: source });
        }

        // A new draft, as `create` builds one, with the source's content
        // written into it: none of the source's history comes along.
        const original = A.load<EventContent>(row.draft);
        const made = copyContent(
          A.from({ ...contentTypes[row.type].initial }),
          original,
        );
        if (!sameContentAs(made, original)) {
          return yield* Effect.die(
            `The copy of ${source} does not have the content of its source`,
          );
        }

        yield* Effect.gen(function* () {
          const [inserted] = yield* sql<{ content: unknown }>`
            INSERT INTO documents (id, type, team_id, draft, created_by_issuer, created_by_subject)
            VALUES (${id}, ${row.type}, ${row.team_id}, ${A.save(made)}::bytea,
              ${author.issuer}, ${author.subject})
            ON CONFLICT (id) DO NOTHING
            RETURNING draft::jsonb AS content
          `;
          // Copied before, by an earlier try: nothing inserted, nothing to check.
          if (inserted === undefined) return;
          yield* rememberName(author);
          // The server's draft must fit the schema, as an editor's must; the
          // transaction rolls back and nothing is stored if it does not.
          yield* Schema.decodeUnknownEffect(contentTypes[row.type].schema)(
            inserted.content,
            { onExcessProperty: "error" },
          );
        }).pipe(sql.withTransaction, Effect.orDie);
        return id;
      }, Effect.uninterruptible);

      const typeOf = Effect.fnUntraced(function* (id: DocumentId) {
        const [row] = yield* sql<{ type: ContentTypeName }>`
          SELECT type FROM documents WHERE id = ${id} AND deleted_at IS NULL
        `.pipe(Effect.orDie);
        if (row === undefined) {
          return yield* new DocumentNotFound({ id });
        }
        return row.type;
      });

      // Per content type, as each has its own table of published versions.
      type PublicationRow = {
        published_heads: Heads;
        published_at: Date;
        first_published_at: Date;
      };
      const toPublication = (row: PublicationRow) =>
        new Publication({
          heads: row.published_heads,
          publishedAt: row.published_at,
          firstPublishedAt: row.first_published_at,
        });

      const changesSince = Effect.fn("Documents.changesSince")(function* (
        id: DocumentId,
        heads: Heads,
      ) {
        const [row] = yield* sql<{ changes: Uint8Array; heads: Heads }>`
          SELECT automerge_changes_bytes(draft, ${heads}::text[]) AS changes,
            automerge_heads(draft) AS heads
          FROM documents WHERE id = ${id} AND deleted_at IS NULL
        `.pipe(Effect.orDie);
        if (row === undefined) {
          return yield* new DocumentNotFound({ id });
        }
        return { changes: row.changes, heads: row.heads };
      });

      const applyChanges = Effect.fn("Documents.applyChanges")(function* (
        id: DocumentId,
        changes: ReadonlyArray<Uint8Array>,
        user: Identity,
      ) {
        const actors = new Set<string>();
        for (const change of changes) {
          const decoded = yield* Effect.try({
            try: () => A.decodeChange(change),
            catch: () => new InvalidChanges({ message: "Malformed change" }),
          });
          actors.add(decoded.actor);
        }
        const bytes = concat(changes);

        return yield* Effect.gen(function* () {
          // Lock the row so the state validated below is the one merged into.
          const [current] = yield* sql<{
            type: ContentTypeName;
            known: boolean;
            heads: Heads;
          }>`
            SELECT type, automerge_contains(draft, ${bytes}::bytea) AS known,
              automerge_heads(draft) AS heads
            FROM documents WHERE id = ${id} AND deleted_at IS NULL FOR UPDATE
          `;
          if (current === undefined) {
            return yield* new DocumentNotFound({ id });
          }
          // Re-sent changes are fine: nothing to do.
          if (current.known) {
            return current.heads;
          }

          // Claim new actor ids for the sender; those taken stay taken.
          const claimed = yield* sql`
            INSERT INTO document_actors (document_id, actor, user_issuer, user_subject)
            SELECT ${id}, actor, ${user.issuer}, ${user.subject}
            FROM unnest(${[...actors]}::text[]) AS actor
            ON CONFLICT (document_id, actor) DO NOTHING
            RETURNING actor
          `;
          // A new editor session: the history names the person from now on.
          if (claimed.length > 0) yield* rememberName(user);
          const allowed = yield* sql<{ actor: string }>`
            SELECT actor FROM document_actors
            WHERE document_id = ${id}
              AND user_issuer = ${user.issuer} AND user_subject = ${user.subject}
          `;
          const allowedActors = new Set(allowed.map((row) => row.actor));
          for (const actor of actors) {
            if (!allowedActors.has(actor)) {
              return yield* new ActorNotAllowed({ actor });
            }
          }

          const [merged] = yield* sql<{ content: unknown }>`
            SELECT merge(draft, ${bytes}::bytea)::jsonb AS content
            FROM documents WHERE id = ${id}
          `;
          yield* Schema.decodeUnknownEffect(contentTypes[current.type].schema)(
            merged?.content,
            { onExcessProperty: "error" },
          ).pipe(
            Effect.mapError(
              (error) => new InvalidContent({ message: error.message }),
            ),
          );

          const [updated] = yield* sql<{ heads: Heads }>`
            UPDATE documents SET draft = merge(draft, ${bytes}::bytea), updated_at = now()
            WHERE id = ${id}
            RETURNING automerge_heads(draft) AS heads
          `;
          return updated?.heads ?? [];
        }).pipe(
          sql.withTransaction,
          Effect.catchIf(SqlError.isSqlError, (error) => {
            switch (pgCode(error)) {
              case "22P02":
              case "22000":
              case "53400":
                return Effect.fail(
                  new InvalidChanges({ message: pgMessage(error) }),
                );
              default:
                return Effect.die(error);
            }
          }),
        );
      }, Effect.uninterruptible);

      const upcoming = sql`ends_at > now()`;

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

      const publishers = {
        event: (
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
            if (
              confirmed !== undefined &&
              !samePublishingNotice(confirmed, answer)
            ) {
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
            if (
              before !== undefined &&
              after !== undefined &&
              change !== null
            ) {
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
                  ...(change.newPlace
                    ? { previousPlace: before.place ?? "" }
                    : {}),
                }),
              );
            }
            // Unpublished before: back on the site. Never a document deleted
            // meanwhile.
            yield* sql`
              UPDATE events e SET deleted_at = NULL
              FROM documents d
              WHERE e.id = ${id} AND d.id = e.id
                AND e.deleted_at IS NOT NULL AND d.deleted_at IS NULL
            `;
            // HubSpot hears of every publish; only a sales event is sent.
            if (after !== undefined) {
              yield* salesEvents.published(id, {
                wasSalesEvent: before?.sales_event === true && !before.off_site,
              });
            }
            return rows;
          }).pipe(
            sql.withTransaction,
            Effect.catchTag("NoticeMismatch", ({ notice }) =>
              Effect.succeed(new NoticeChanged({ notice })),
            ),
          ),
      } satisfies Record<ContentTypeName, unknown>;

      const unknownVersion = (error: SqlError.SqlError) =>
        pgCode(error) === "22023"
          ? Effect.fail(
              new PublishRejected(refused({ _tag: "UnknownVersion" })),
            )
          : Effect.die(error);

      const publishable = Effect.fnUntraced(function* (
        id: DocumentId,
        heads: Heads,
      ) {
        const type = yield* typeOf(id);
        const [version] = yield* sql<{ content: unknown }>`
          SELECT automerge_to_jsonb(draft, ${heads}::text[]) AS content
          FROM documents WHERE id = ${id}
        `.pipe(Effect.catchIf(SqlError.isSqlError, unknownVersion));
        const content = yield* Schema.decodeUnknownEffect(
          contentTypes[type].schema,
        )(version?.content).pipe(Effect.orDie);
        const missing = cantPublish(contentTypes[type], content);
        if (missing !== null) {
          return yield* new PublishRejected(refused(missing));
        }
        return type;
      });

      const publishingNotice = Effect.fn("Documents.publishingNotice")(
        function* (id: DocumentId, heads: Heads, user: Identity) {
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
            Effect.catchTag("NoticePreview", ({ notice }) =>
              Effect.succeed(notice),
            ),
            Effect.catchIf(SqlError.isSqlError, unknownVersion),
          );
        },
      );

      const publishAction = Effect.fn("Documents.publish")(function* (
        id: DocumentId,
        heads: Heads,
        user: Identity,
        confirmed?: PublishingNotice,
      ) {
        const type = yield* publishable(id, heads);

        const published = yield* publishers[type](
          id,
          heads,
          user,
          confirmed,
        ).pipe(Effect.catchIf(SqlError.isSqlError, unknownVersion));
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

      const discardChanges = Effect.fn("Documents.discardChanges")(function* (
        id: DocumentId,
        user: Identity,
      ) {
        const found = yield* Effect.gen(function* () {
          // The document first, then the event: the order `delete` locks them in.
          const [document] = yield* sql<{ draft: Uint8Array }>`
            SELECT draft::bytea AS draft FROM documents
            WHERE id = ${id} AND deleted_at IS NULL FOR UPDATE
          `;
          if (document === undefined) return false;
          const [event] = yield* sql<{
            published_heads: Heads;
            published_by_issuer: string;
            published_by_subject: string;
          }>`
            SELECT published_heads, published_by_issuer, published_by_subject
            FROM events WHERE id = ${id} AND deleted_at IS NULL FOR UPDATE
          `;
          // Never published, or unpublished: nothing to go back to.
          if (event === undefined) return true;

          const published = [...event.published_heads];
          const restored = restorePublished(
            A.load<EventContent>(document.draft),
            published,
            { message: discardedMessage },
          );
          // A version other than the published one is never published by a
          // discard.
          if (!sameContent(restored, published)) {
            return yield* Effect.die(
              `Discarding the changes of ${id} did not give the published version back`,
            );
          }
          const change = A.getLastLocalChange(restored);
          if (change !== undefined) {
            // The server's change must fit the draft's schema, as an editor's must.
            yield* claimActor(id, A.getActorId(restored), user);
            yield* rememberName(user);
            yield* applyServerChange(sql, id, change, (content) =>
              Schema.decodeUnknownEffect(contentTypes.event.schema)(content, {
                onExcessProperty: "error",
              }),
            );
          }

          // Published again at the draft's heads, which differ from the
          // published ones even when the content is the same (an edit typed
          // and undone). No notices and no announcement: nothing published
          // changed, and the signups stay.
          const heads = [...A.getHeads(restored)].sort();
          if (heads.join() !== [...published].sort().join()) {
            const [row] = yield* publishEvent(
              sql,
              id,
              heads,
              {
                issuer: event.published_by_issuer,
                subject: event.published_by_subject,
              },
              {
                issuer: event.published_by_issuer,
                subject: event.published_by_subject,
              },
            );
            if (row === undefined) {
              return yield* Effect.die(`Event ${id} was not published again`);
            }
          }
          return true;
        }).pipe(sql.withTransaction, Effect.orDie);
        if (!found) {
          return yield* new DocumentNotFound({ id });
        }
      }, Effect.uninterruptible);

      const history = Effect.fn("Documents.history")(function* (
        id: DocumentId,
      ) {
        const entries = yield* readHistory(sql, id).pipe(Effect.orDie);
        if (entries === undefined) {
          return yield* new DocumentNotFound({ id });
        }
        return entries;
      });

      const restore = Effect.fn("Documents.restore")(function* (
        id: DocumentId,
        heads: Heads,
        user: Identity,
      ) {
        // Checked before the transaction: a string that is not a change hash
        // never reaches `A.hasHeads`, which looks each one up.
        if (!isVersion(heads)) {
          return yield* new RestoreRejected(
            refused({ _tag: "UnknownVersion" }),
          );
        }
        yield* Effect.gen(function* () {
          const [document] = yield* sql<{ draft: Uint8Array }>`
            SELECT draft::bytea AS draft FROM documents
            WHERE id = ${id} AND deleted_at IS NULL FOR UPDATE
          `;
          if (document === undefined) {
            return yield* new DocumentNotFound({ id });
          }
          const doc = A.load<EventContent>(document.draft);
          if (!A.hasHeads(doc, [...heads])) {
            return yield* new RestoreRejected(
              refused({ _tag: "UnknownVersion" }),
            );
          }
          let restored = restorePublished(doc, [...heads], {
            message: restoredMessage,
          });
          // Already that version: the restoring is still an entry.
          if (A.getLastLocalChange(restored) === undefined) {
            restored = A.emptyChange(doc, { message: restoredMessage });
          }
          if (!sameContent(restored, [...heads])) {
            return yield* Effect.die(
              `Restoring ${id} did not give the version back`,
            );
          }
          const change = A.getLastLocalChange(restored);
          if (change === undefined) {
            return yield* Effect.die(`Restoring ${id} made no change`);
          }
          // The server's change must fit the draft's schema, as an editor's must.
          const [merged] = yield* sql<{ content: unknown }>`
            SELECT merge(draft, ${change}::bytea)::jsonb AS content
            FROM documents WHERE id = ${id}
          `;
          yield* Schema.decodeUnknownEffect(contentTypes.event.schema)(
            merged?.content,
            { onExcessProperty: "error" },
          ).pipe(Effect.orDie);
          yield* claimActor(id, A.getActorId(restored), user);
          yield* rememberName(user);
          // The draft only: the published version, the signups and the site
          // are as they were.
          yield* sql`
            UPDATE documents SET draft = merge(draft, ${change}::bytea), updated_at = now()
            WHERE id = ${id}
          `;
        }).pipe(
          sql.withTransaction,
          Effect.catchIf(SqlError.isSqlError, Effect.die),
        );
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

      // `updated_at` stays as it is: moving does not edit the event.
      const move = Effect.fn("Documents.move")(function* (
        id: DocumentId,
        team: TeamId,
      ) {
        const [moved] = yield* sql<{ id: DocumentId }>`
          UPDATE documents SET team_id = ${team}
          WHERE id = ${id} AND deleted_at IS NULL AND first_published_at IS NULL
          RETURNING id
        `.pipe(
          Effect.catchIf(SqlError.isSqlError, (error) =>
            pgCode(error) === "23503"
              ? Effect.fail(new TeamNotFound({ id: team }))
              : Effect.die(error),
          ),
        );
        if (moved !== undefined) return;
        const [found] = yield* sql`
          SELECT 1 FROM documents WHERE id = ${id} AND deleted_at IS NULL
        `.pipe(Effect.orDie);
        if (found === undefined) {
          return yield* new DocumentNotFound({ id });
        }
        return yield* new MoveRejected(refused({ _tag: "OrganizerLocked" }));
      }, Effect.uninterruptible);

      return Documents.of({
        create,
        copy,
        move,
        get,
        changesSince,
        applyChanges,
        publish,
        publishConfirmed,
        publishingNotice,
        cancellingNotice,
        unpublish,
        discardChanges,
        history,
        restore,
        delete: deleteDocument,
      });
    }),
  );
}

const concat = (chunks: ReadonlyArray<Uint8Array>): Uint8Array => {
  const result = new Uint8Array(
    chunks.reduce((length, chunk) => length + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
};
