import { Effect } from "effect";
import type { SqlClient } from "effect/sql";
import type { DocumentId } from "../Model.ts";

export const applyServerChange = <E, R>(
  sql: SqlClient.SqlClient,
  id: DocumentId,
  change: Uint8Array,
  validate: (content: unknown) => Effect.Effect<unknown, E, R>,
) =>
  Effect.gen(function* () {
    yield* sql`SELECT id FROM documents WHERE id = ${id} FOR UPDATE`;
    const [merged] = yield* sql<{ content: unknown }>`
      SELECT merge(draft, ${change}::bytea)::jsonb AS content
      FROM documents WHERE id = ${id}
    `;
    yield* validate(merged?.content);
    yield* sql`
      UPDATE documents
      SET draft = merge(draft, ${change}::bytea), updated_at = now()
      WHERE id = ${id}
    `;
  });
