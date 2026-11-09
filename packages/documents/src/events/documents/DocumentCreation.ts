import * as A from "@automerge/automerge";
import { type Identity, nameOf } from "@skjera/oauth/api";
import { Effect, Schema } from "effect";
import { type SqlClient, SqlError } from "effect/sql";
import { DocumentNotFound, TeamNotFound } from "../../api/errors.ts";
import type { DocumentId, Heads, TeamId } from "../../Model.ts";
import { pgCode } from "../../server/PostgresError.ts";
import {
  type ContentTypeName,
  EventContent,
  eventInitial,
} from "../ContentTypes.ts";
import { copyContent, sameContentAs } from "./DiscardChanges.ts";

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

export const documentCreation = (sql: SqlClient.SqlClient) => {
  // Writes run to their end, even if the client that asked goes away.
  const create = Effect.fn("Documents.create")(function* (
    type: ContentTypeName,
    team: TeamId,
    author: Identity,
    id?: DocumentId,
  ) {
    // The initial state gets an actor id of its own, which no editor
    // will ever use.
    const draft = A.save(A.from({ ...eventInitial }));
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
    const made = copyContent(A.from({ ...eventInitial }), original);
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
      yield* Schema.decodeUnknownEffect(EventContent)(inserted.content, {
        onExcessProperty: "error",
      });
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

  return { create, copy, get, typeOf, rememberName, claimActor };
};
