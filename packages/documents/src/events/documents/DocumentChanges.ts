import * as A from "@automerge/automerge";
import type { Identity } from "@skjera/oauth/api";
import { Effect, Schema } from "effect";
import { type SqlClient, SqlError } from "effect/sql";
import {
  ActorNotAllowed,
  DocumentNotFound,
  InvalidChanges,
  InvalidContent,
} from "../../api/errors.ts";
import type { DocumentId, Heads } from "../../Model.ts";
import { pgCode, pgMessage } from "../../server/PostgresError.ts";
import { type ContentTypeName, EventContent } from "../ContentTypes.ts";

export const documentChanges = (
  sql: SqlClient.SqlClient,
  rememberName: (user: Identity) => Effect.Effect<void, SqlError.SqlError>,
) => {
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
      yield* Schema.decodeUnknownEffect(EventContent)(merged?.content, {
        onExcessProperty: "error",
      }).pipe(
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

  return { changesSince, applyChanges };
};

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
