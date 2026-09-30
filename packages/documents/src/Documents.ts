import * as A from "@automerge/automerge";
import type { Identity } from "@skjera/oauth/api";
import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlError } from "effect/sql";
import { type ContentTypeName, contentTypes } from "./ContentTypes.ts";
import {
  ActorNotAllowed,
  DocumentNotFound,
  InvalidChanges,
  InvalidContent,
  PublishRejected,
} from "./errors.ts";
import {
  type DocumentId,
  DocumentSummary,
  type Heads,
  Publication,
} from "./Model.ts";

export interface DocumentSnapshot {
  readonly id: DocumentId;
  readonly type: ContentTypeName;
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
    readonly create: (
      type: ContentTypeName,
      author: Identity,
    ) => Effect.Effect<DocumentId>;
    /** Documents of a type, most recently edited first. */
    readonly list: (
      type: ContentTypeName,
    ) => Effect.Effect<ReadonlyArray<DocumentSummary>>;
    readonly get: (
      id: DocumentId,
    ) => Effect.Effect<DocumentSnapshot, DocumentNotFound>;
    /** The current published version, if any. */
    readonly publication: (
      id: DocumentId,
    ) => Effect.Effect<Publication | null, DocumentNotFound>;
    /** What a replica at `heads` is missing, as change chunks for `Automerge.loadIncremental`. */
    readonly changesSince: (
      id: DocumentId,
      heads: Heads,
    ) => Effect.Effect<Uint8Array, DocumentNotFound>;
    /** Lets `user` send changes under `actor`, the actor id of their editor session. */
    readonly registerActor: (
      id: DocumentId,
      actor: string,
      user: Identity,
    ) => Effect.Effect<void, DocumentNotFound | ActorNotAllowed>;
    /**
     * Merges changes into the draft, after checking they come from the
     * sender's own actor ids and leave the draft valid for its content type.
     * Returns the new heads.
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
    /** Deletes the document, its published version included. */
    readonly delete: (id: DocumentId) => Effect.Effect<void, DocumentNotFound>;
  }
>()("@skjera/documents/Documents") {
  static readonly layer = Layer.effect(
    Documents,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const create = Effect.fn("Documents.create")(function* (
        type: ContentTypeName,
        author: Identity,
      ) {
        // The initial state gets an actor id of its own, which no editor
        // will ever use.
        const draft = A.save(A.from({ ...contentTypes[type].initial }));
        const [row] = yield* sql<{ id: DocumentId }>`
          INSERT INTO documents (type, draft, created_by_issuer, created_by_subject)
          VALUES (${type}, ${draft}::bytea, ${author.issuer}, ${author.subject})
          RETURNING id
        `;
        if (row === undefined) {
          return yield* Effect.die("INSERT returned no row");
        }
        return row.id;
      }, Effect.orDie);

      const get = Effect.fn("Documents.get")(function* (id: DocumentId) {
        const [row] = yield* sql<{
          type: ContentTypeName;
          heads: Heads;
          draft: Uint8Array;
        }>`
          SELECT type, automerge_heads(draft) AS heads, draft::bytea AS draft
          FROM documents WHERE id = ${id}
        `.pipe(Effect.orDie);
        if (row === undefined) {
          return yield* new DocumentNotFound({ id });
        }
        return { id, ...row };
      });

      const typeOf = Effect.fnUntraced(function* (id: DocumentId) {
        const [row] = yield* sql<{ type: ContentTypeName }>`
          SELECT type FROM documents WHERE id = ${id}
        `.pipe(Effect.orDie);
        if (row === undefined) {
          return yield* new DocumentNotFound({ id });
        }
        return row.type;
      });

      // Per content type, as each has its own table of published versions.
      const summaries = {
        post: sql<{
          id: DocumentId;
          title: string;
          updated_at: Date;
          published_at: Date | null;
          has_unpublished_changes: boolean;
        }>`
          SELECT d.id, c.content->>'title' AS title, d.updated_at, p.published_at,
            automerge_heads(d.draft) IS DISTINCT FROM p.published_heads AS has_unpublished_changes
          FROM documents d
          CROSS JOIN LATERAL (SELECT d.draft::jsonb AS content OFFSET 0) c
          LEFT JOIN posts p ON p.id = d.id
          WHERE d.type = 'post'
          ORDER BY d.updated_at DESC
        `,
      } satisfies Record<ContentTypeName, unknown>;

      const list = Effect.fn("Documents.list")(function* (
        type: ContentTypeName,
      ) {
        const rows = yield* summaries[type].pipe(Effect.orDie);
        return rows.map(
          (row) =>
            new DocumentSummary({
              id: row.id,
              title: row.title,
              updatedAt: row.updated_at,
              publishedAt: row.published_at,
              hasUnpublishedChanges: row.has_unpublished_changes,
            }),
        );
      });

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

      const publications = {
        post: (id: DocumentId) =>
          sql<PublicationRow>`
            SELECT published_heads, published_at, first_published_at
            FROM posts WHERE id = ${id}
          `,
      } satisfies Record<ContentTypeName, unknown>;

      const publication = Effect.fn("Documents.publication")(function* (
        id: DocumentId,
      ) {
        const type = yield* typeOf(id);
        const [row] = yield* publications[type](id).pipe(Effect.orDie);
        return row === undefined ? null : toPublication(row);
      });

      const changesSince = Effect.fn("Documents.changesSince")(function* (
        id: DocumentId,
        heads: Heads,
      ) {
        const [row] = yield* sql<{ changes: Uint8Array }>`
          SELECT automerge_changes_bytes(draft, ${heads}::text[]) AS changes
          FROM documents WHERE id = ${id}
        `.pipe(Effect.orDie);
        if (row === undefined) {
          return yield* new DocumentNotFound({ id });
        }
        return row.changes;
      });

      const registerActor = Effect.fn("Documents.registerActor")(function* (
        id: DocumentId,
        actor: string,
        user: Identity,
      ) {
        yield* sql`
          INSERT INTO document_actors (document_id, actor, user_issuer, user_subject)
          VALUES (${id}, ${actor}, ${user.issuer}, ${user.subject})
          ON CONFLICT (document_id, actor) DO NOTHING
        `.pipe(
          Effect.catchIf(SqlError.isSqlError, (error) =>
            pgCode(error) === "23503"
              ? Effect.fail(new DocumentNotFound({ id }))
              : Effect.die(error),
          ),
        );
        const [owner] = yield* sql<{ issuer: string; subject: string }>`
          SELECT user_issuer AS issuer, user_subject AS subject
          FROM document_actors WHERE document_id = ${id} AND actor = ${actor}
        `.pipe(Effect.orDie);
        if (
          owner === undefined ||
          owner.issuer !== user.issuer ||
          owner.subject !== user.subject
        ) {
          return yield* new ActorNotAllowed({ actor });
        }
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
            FROM documents WHERE id = ${id} FOR UPDATE
          `;
          if (current === undefined) {
            return yield* new DocumentNotFound({ id });
          }
          // Re-sent changes are fine: nothing to do.
          if (current.known) {
            return current.heads;
          }

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
        post: (id: DocumentId, heads: Heads, user: Identity) =>
          sql<PublicationRow>`
            SELECT published_heads, published_at, first_published_at
            FROM publish_post(${id}, ${heads}::text[], ${user.issuer}, ${user.subject})
          `,
      } satisfies Record<ContentTypeName, unknown>;

      const publish = Effect.fn("Documents.publish")(function* (
        id: DocumentId,
        heads: Heads,
        user: Identity,
      ) {
        const type = yield* typeOf(id);
        const [row] = yield* publishers[type](id, heads, user).pipe(
          Effect.catchIf(SqlError.isSqlError, (error) => {
            switch (pgCode(error)) {
              case "22023":
                return Effect.fail(
                  new PublishRejected({ message: "Unknown version" }),
                );
              case "23514":
                return Effect.fail(
                  new PublishRejected({
                    message: "The content isn't ready to publish",
                  }),
                );
              default:
                return Effect.die(error);
            }
          }),
        );
        if (row === undefined) {
          return yield* new DocumentNotFound({ id });
        }
        return toPublication(row);
      });

      const deleteDocument = Effect.fn("Documents.delete")(function* (
        id: DocumentId,
      ) {
        // The published version and actor records go with it (ON DELETE CASCADE).
        const deleted = yield* sql`
          DELETE FROM documents WHERE id = ${id} RETURNING id
        `.pipe(Effect.orDie);
        if (deleted.length === 0) {
          return yield* new DocumentNotFound({ id });
        }
      });

      return Documents.of({
        create,
        list,
        get,
        publication,
        changesSince,
        registerActor,
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
