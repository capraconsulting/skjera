import * as A from "@automerge/automerge";
import type { Identity } from "@skjera/oauth/api";
import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlError } from "effect/sql";
import { Announcements } from "./Announcements.ts";
import {
  type ContentTypeName,
  cantPublish,
  contentTypes,
} from "./ContentTypes.ts";
import {
  ActorNotAllowed,
  DocumentNotFound,
  InvalidChanges,
  InvalidContent,
  PublishRejected,
  TeamNotFound,
} from "./errors.ts";
import {
  type DocumentId,
  type Heads,
  Publication,
  type TeamId,
} from "./Model.ts";
import { Notifications, type Signup, tell } from "./Notifications.ts";
import { refused } from "./Problems.ts";

/** When and where an event is, as published. */
interface WhenAndWhere {
  readonly starts_at: Date;
  readonly ends_at: Date;
  /** Null: published before events had a place. */
  readonly place: string | null;
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
    /**
     * Deletes the document, taking its published version off the site. It's
     * kept, marked deleted. An event's attendees are told it's cancelled,
     * unless it's over.
     */
    readonly delete: (
      id: DocumentId,
      user: Identity,
    ) => Effect.Effect<void, DocumentNotFound>;
  }
>()("@skjera/documents/Documents") {
  static readonly layer = Layer.effect(
    Documents,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const notifications = yield* Notifications;
      const announcements = yield* Announcements;

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
        if (row !== undefined) return row.id;
        // Created before, by an earlier try.
        if (id !== undefined) return id;
        return yield* Effect.die("INSERT returned no row");
      });

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
          yield* sql`
            INSERT INTO document_actors (document_id, actor, user_issuer, user_subject)
            SELECT ${id}, actor, ${user.issuer}, ${user.subject}
            FROM unnest(${[...actors]}::text[]) AS actor
            ON CONFLICT (document_id, actor) DO NOTHING
          `;
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
      });

      const publishers = {
        event: (id: DocumentId, heads: Heads, user: Identity) =>
          Effect.gen(function* () {
            const [before] = yield* sql<WhenAndWhere>`
              SELECT starts_at, ends_at, place FROM events WHERE id = ${id} FOR UPDATE
            `;
            const rows = yield* sql<PublicationRow & WhenAndWhere>`
              SELECT published_heads, published_at, first_published_at,
                starts_at, ends_at, place
              FROM publish_event(${id}, ${heads}::text[], ${user.issuer}, ${user.subject})
            `;
            const [after] = rows;
            // Published for the first time: the channel is told, once.
            if (before === undefined && after !== undefined) {
              yield* announcements.eventPublished(id);
            }
            const moved =
              before !== undefined &&
              after !== undefined &&
              (before.starts_at.getTime() !== after.starts_at.getTime() ||
                before.ends_at.getTime() !== after.ends_at.getTime());
            const newPlace =
              before !== undefined &&
              after !== undefined &&
              before.place !== after.place;
            // Moved, or somewhere else: its attendees are told, in one
            // email, and get the new time and place for their calendars.
            if (
              before !== undefined &&
              after !== undefined &&
              (moved || newPlace)
            ) {
              const signups = yield* sql<Signup>`
                SELECT id, name, email, user_issuer IS NULL AS guest, locale
                FROM attendees WHERE event_id = ${id}
              `;
              yield* tell(signups, (attendee) =>
                notifications.eventChanged({
                  event: id,
                  attendee,
                  version: String(after.published_at.getTime()),
                  ...(moved
                    ? {
                        previously: {
                          startsAt: before.starts_at.toISOString(),
                          endsAt: before.ends_at.toISOString(),
                        },
                      }
                    : {}),
                  ...(newPlace ? { previousPlace: before.place ?? "" } : {}),
                }),
              );
            }
            return rows;
          }).pipe(sql.withTransaction),
      } satisfies Record<ContentTypeName, unknown>;

      const unknownVersion = (error: SqlError.SqlError) =>
        pgCode(error) === "22023"
          ? Effect.fail(
              new PublishRejected(refused({ _tag: "UnknownVersion" })),
            )
          : Effect.die(error);

      const publish = Effect.fn("Documents.publish")(function* (
        id: DocumentId,
        heads: Heads,
        user: Identity,
      ) {
        const type = yield* typeOf(id);

        // Check the version being published first, so the message names
        // everything that is missing. The table constraints are a backstop.
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

        const [row] = yield* publishers[type](id, heads, user).pipe(
          Effect.catchIf(SqlError.isSqlError, unknownVersion),
        );
        if (row === undefined) {
          return yield* new DocumentNotFound({ id });
        }
        return toPublication(row);
      });

      const deleteDocument = Effect.fn("Documents.delete")(function* (
        id: DocumentId,
        user: Identity,
      ) {
        const found = yield* Effect.gen(function* () {
          const deleted = yield* sql`
            UPDATE documents SET deleted_at = now(),
              deleted_by_issuer = ${user.issuer}, deleted_by_subject = ${user.subject}
            WHERE id = ${id} AND deleted_at IS NULL
            RETURNING id
          `;
          if (deleted.length === 0) return false;
          const [event] = yield* sql<{ upcoming: boolean }>`
            UPDATE events SET deleted_at = now() WHERE id = ${id}
            RETURNING ends_at > now() AS upcoming
          `;
          // Signed up for what won't happen now: cancelled, in calendars too.
          if (event?.upcoming) {
            const signups = yield* sql<Signup>`
              SELECT id, name, email, user_issuer IS NULL AS guest, locale
              FROM attendees WHERE event_id = ${id}
            `;
            yield* tell(signups, (attendee) =>
              notifications.eventCancelled({ event: id, attendee }),
            );
          }
          return true;
        }).pipe(sql.withTransaction, Effect.orDie);
        if (!found) {
          return yield* new DocumentNotFound({ id });
        }
      });

      return Documents.of({
        create,
        get,
        changesSince,
        applyChanges,
        publish,
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

// The Postgres error behind a failed query: SQLSTATE and message.
const pgCause = (error: SqlError.SqlError) =>
  (error.reason as { cause?: { code?: string; message?: string } }).cause;

const pgCode = (error: SqlError.SqlError): string | undefined =>
  pgCause(error)?.code;

const pgMessage = (error: SqlError.SqlError): string =>
  pgCause(error)?.message ?? error.message;
