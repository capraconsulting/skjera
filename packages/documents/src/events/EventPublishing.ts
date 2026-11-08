import { Effect } from "effect";
import type { SqlClient } from "effect/sql";
import type { DocumentId, Heads } from "../Model.ts";

export interface PublishedEventRow {
  readonly published_heads: Heads;
  readonly published_at: Date;
  readonly first_published_at: Date;
  readonly starts_at: Date;
  readonly ends_at: Date;
  readonly place: string | null;
}

export const publishEvent = (
  sql: SqlClient.SqlClient,
  id: DocumentId,
  heads: Heads,
  publisher: { readonly issuer: string; readonly subject: string },
  recordedBy: { readonly issuer: string; readonly subject: string } | null,
) =>
  Effect.gen(function* () {
    yield* sql`SELECT id FROM documents WHERE id = ${id} FOR UPDATE`;
    const rows = yield* sql<PublishedEventRow>`
      SELECT published_heads, published_at, first_published_at,
        starts_at, ends_at, place
      FROM publish_event(${id}, ${heads}::text[], ${publisher.issuer}, ${publisher.subject})
    `;
    const published = rows[0];
    if (published !== undefined) {
      yield* sql`
        INSERT INTO event_publications
          (event_id, heads, published_by_issuer, published_by_subject)
        VALUES (${id}, ${published.published_heads}::text[],
          ${recordedBy?.issuer ?? null}, ${recordedBy?.subject ?? null})
      `;
    }
    return rows;
  });
