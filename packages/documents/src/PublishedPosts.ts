import { Context, Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { PostNotFound } from "./errors.ts";
import { type DocumentId, PublishedPost } from "./Model.ts";

type Row = {
  id: DocumentId;
  title: string;
  body: string;
  published_at: Date;
  first_published_at: Date;
};

const toPost = (row: Row) =>
  new PublishedPost({
    id: row.id,
    title: row.title,
    body: row.body,
    publishedAt: row.published_at,
    firstPublishedAt: row.first_published_at,
  });

/**
 * Published posts, for the public site. Reads only the `posts` table, so
 * drafts and unpublished edits can't leak out through it.
 */
export class PublishedPosts extends Context.Service<
  PublishedPosts,
  {
    /** Newest first. */
    readonly list: Effect.Effect<ReadonlyArray<PublishedPost>>;
    readonly get: (
      id: DocumentId,
    ) => Effect.Effect<PublishedPost, PostNotFound>;
  }
>()("@skjera/documents/PublishedPosts") {
  static readonly layer = Layer.effect(
    PublishedPosts,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const list = sql<Row>`
        SELECT id, title, body, published_at, first_published_at
        FROM posts ORDER BY first_published_at DESC
      `.pipe(
        Effect.map((rows) => rows.map(toPost)),
        Effect.orDie,
        Effect.withSpan("PublishedPosts.list"),
      );

      const get = Effect.fn("PublishedPosts.get")(function* (id: DocumentId) {
        const [row] = yield* sql<Row>`
          SELECT id, title, body, published_at, first_published_at
          FROM posts WHERE id = ${id}
        `.pipe(Effect.orDie);
        if (row === undefined) {
          return yield* new PostNotFound({ id });
        }
        return toPost(row);
      });

      return PublishedPosts.of({ list, get });
    }),
  );
}
