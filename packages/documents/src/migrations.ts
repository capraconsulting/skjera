import { Effect } from "effect";
import { Migrator, SqlClient } from "effect/sql";

// The Postgres client runs one statement per query, so each migration is a
// list of statements. The migrator runs every migration in a transaction.
const statements = (...queries: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    for (const query of queries) {
      yield* sql.unsafe(query);
    }
  });

export const migrations = Migrator.fromRecord({
  "0001_documents": statements(
    `CREATE EXTENSION IF NOT EXISTS pg_automerge`,
    // One row per document. `draft` is the live Automerge document that
    // editors change together; published content lives in per-type tables.
    `CREATE TABLE documents (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      type text NOT NULL,
      draft automerge NOT NULL,
      created_by_issuer text NOT NULL,
      created_by_subject text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX documents_type_updated_at_idx ON documents (type, updated_at DESC)`,
    // Tells every backend when a draft changed, with its new heads.
    `CREATE TRIGGER documents_notify AFTER INSERT OR UPDATE OR DELETE ON documents
      FOR EACH ROW EXECUTE FUNCTION automerge_notify('documents_changed', 'id')`,
    // The user behind each Automerge actor id. Every editor session gets a
    // fresh actor id; changes are only accepted from the actor ids of the
    // user sending them, which also attributes the document's history.
    `CREATE TABLE document_actors (
      document_id uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
      actor text NOT NULL,
      user_issuer text NOT NULL,
      user_subject text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (document_id, actor)
    )`,
  ),
  "0002_posts": statements(
    // The published version of each post: what readers get.
    `CREATE TABLE posts (
      id uuid PRIMARY KEY REFERENCES documents (id) ON DELETE CASCADE,
      title text NOT NULL CHECK (btrim(title) <> ''),
      body text NOT NULL,
      published_heads text[] NOT NULL,
      published_by_issuer text NOT NULL,
      published_by_subject text NOT NULL,
      first_published_at timestamptz NOT NULL,
      published_at timestamptz NOT NULL
    )`,
    // Publish times are set by the database, never by the caller.
    `CREATE FUNCTION set_publish_times() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      NEW.published_at := now();
      NEW.first_published_at := CASE WHEN TG_OP = 'UPDATE' THEN OLD.first_published_at ELSE now() END;
      RETURN NEW;
    END
    $$`,
    `CREATE TRIGGER posts_publish_times BEFORE INSERT OR UPDATE ON posts
      FOR EACH ROW EXECUTE FUNCTION set_publish_times()`,
    // Materializes the draft as of the given heads (the version the user saw
    // when they clicked publish) into posts.
    `CREATE FUNCTION publish_post(document_id uuid, heads text[], issuer text, subject text)
      RETURNS SETOF posts LANGUAGE sql AS $$
      INSERT INTO posts AS p (id, title, body, published_heads, published_by_issuer, published_by_subject)
      SELECT d.id, c.content->>'title', c.content->>'body',
        -- Sorted like automerge_heads(), so the two can be compared.
        ARRAY(SELECT h FROM unnest(heads) AS h ORDER BY h), issuer, subject
      FROM documents d
      CROSS JOIN LATERAL (SELECT automerge_to_jsonb(d.draft, heads) AS content OFFSET 0) c
      WHERE d.id = document_id AND d.type = 'post'
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        body = EXCLUDED.body,
        published_heads = EXCLUDED.published_heads,
        published_by_issuer = EXCLUDED.published_by_issuer,
        published_by_subject = EXCLUDED.published_by_subject
      RETURNING p.*
    $$`,
  ),
});
