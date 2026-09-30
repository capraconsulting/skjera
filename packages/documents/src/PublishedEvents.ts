import { Context, Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { EventNotFound } from "./errors.ts";
import { type DocumentId, type IsoDate, PublishedEvent } from "./Model.ts";

type Row = {
  id: DocumentId;
  title: string;
  date: IsoDate;
  body: string;
  is_public: boolean;
  allow_guests: boolean;
  ask_dietary: boolean;
  published_at: Date;
  first_published_at: Date;
};

const toEvent = (row: Row) =>
  new PublishedEvent({
    id: row.id,
    title: row.title,
    date: row.date,
    body: row.body,
    isPublic: row.is_public,
    allowGuests: row.allow_guests,
    askDietary: row.ask_dietary,
    publishedAt: row.published_at,
    firstPublishedAt: row.first_published_at,
  });

/**
 * Who is looking: anyone sees public events, signed-in users see all
 * published events.
 */
export type Audience = "anyone" | "members";

/**
 * Published events, for the site. Reads only the `events` table, so drafts
 * and unpublished edits can't leak out through it. Members-only events are
 * "not found" to anyone else.
 */
export class PublishedEvents extends Context.Service<
  PublishedEvents,
  {
    /** By date, earliest first. */
    readonly list: (
      audience: Audience,
    ) => Effect.Effect<ReadonlyArray<PublishedEvent>>;
    readonly get: (
      id: DocumentId,
      audience: Audience,
    ) => Effect.Effect<PublishedEvent, EventNotFound>;
  }
>()("@skjera/documents/PublishedEvents") {
  static readonly layer = Layer.effect(
    PublishedEvents,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const list = Effect.fn("PublishedEvents.list")(function* (
        audience: Audience,
      ) {
        const rows = yield* sql<Row>`
          SELECT id, title, event_date::text AS date, body, is_public, allow_guests, ask_dietary,
            published_at, first_published_at
          FROM events
          WHERE is_public OR ${audience === "members"}
          ORDER BY event_date, first_published_at
        `.pipe(Effect.orDie);
        return rows.map(toEvent);
      });

      const get = Effect.fn("PublishedEvents.get")(function* (
        id: DocumentId,
        audience: Audience,
      ) {
        const [row] = yield* sql<Row>`
          SELECT id, title, event_date::text AS date, body, is_public, allow_guests, ask_dietary,
            published_at, first_published_at
          FROM events
          WHERE id = ${id} AND (is_public OR ${audience === "members"})
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
