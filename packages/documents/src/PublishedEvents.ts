import { Context, Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { EventNotFound } from "./errors.ts";
import { type DocumentId, type IsoDate, PublishedEvent } from "./Model.ts";

type Row = {
  id: DocumentId;
  title: string;
  date: IsoDate;
  body: string;
  published_at: Date;
  first_published_at: Date;
};

const toEvent = (row: Row) =>
  new PublishedEvent({
    id: row.id,
    title: row.title,
    date: row.date,
    body: row.body,
    publishedAt: row.published_at,
    firstPublishedAt: row.first_published_at,
  });

/**
 * Published events, for the public site. Reads only the `events` table, so
 * drafts and unpublished edits can't leak out through it.
 */
export class PublishedEvents extends Context.Service<
  PublishedEvents,
  {
    /** By date, earliest first. */
    readonly list: Effect.Effect<ReadonlyArray<PublishedEvent>>;
    readonly get: (
      id: DocumentId,
    ) => Effect.Effect<PublishedEvent, EventNotFound>;
  }
>()("@skjera/documents/PublishedEvents") {
  static readonly layer = Layer.effect(
    PublishedEvents,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const list = sql<Row>`
        SELECT id, title, event_date::text AS date, body, published_at, first_published_at
        FROM events ORDER BY event_date, first_published_at
      `.pipe(
        Effect.map((rows) => rows.map(toEvent)),
        Effect.orDie,
        Effect.withSpan("PublishedEvents.list"),
      );

      const get = Effect.fn("PublishedEvents.get")(function* (id: DocumentId) {
        const [row] = yield* sql<Row>`
          SELECT id, title, event_date::text AS date, body, published_at, first_published_at
          FROM events WHERE id = ${id}
        `.pipe(Effect.orDie);
        if (row === undefined) {
          return yield* new EventNotFound({ id });
        }
        return toEvent(row);
      });

      return PublishedEvents.of({ list, get });
    }),
  );
}
