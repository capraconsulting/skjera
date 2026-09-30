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
    // Teams own documents. Anyone signed in can see all teams and create new
    // ones. They only organize the studio; the public site doesn't show them.
    `CREATE TABLE teams (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      name text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 100),
      created_by_issuer text NOT NULL,
      created_by_subject text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX teams_name_key ON teams (lower(name))`,
    // One row per document. `draft` is the live Automerge document that
    // editors change together; published content lives in per-type tables.
    `CREATE TABLE documents (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      type text NOT NULL,
      team_id uuid NOT NULL REFERENCES teams (id) ON DELETE RESTRICT,
      draft automerge NOT NULL,
      created_by_issuer text NOT NULL,
      created_by_subject text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX documents_team_id_idx ON documents (team_id, updated_at DESC)`,
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
    // Publish times are set by the database, never by the caller.
    `CREATE FUNCTION set_publish_times() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      NEW.published_at := now();
      NEW.first_published_at := CASE WHEN TG_OP = 'UPDATE' THEN OLD.first_published_at ELSE now() END;
      RETURN NEW;
    END
    $$`,
  ),
  "0002_events": statements(
    // The published version of each event: what the public site shows.
    // Publishing needs a title and a date.
    `CREATE TABLE events (
      id uuid PRIMARY KEY REFERENCES documents (id) ON DELETE CASCADE,
      title text NOT NULL CHECK (btrim(title) <> ''),
      event_date date NOT NULL,
      body text NOT NULL,
      -- Public events are visible without logging in; the others only to
      -- signed-in users. Guests (people without an account) can only sign
      -- up for public events.
      is_public boolean NOT NULL,
      allow_guests boolean NOT NULL CHECK (is_public OR NOT allow_guests),
      -- Everyone signing up must give their dietary preferences.
      ask_dietary boolean NOT NULL,
      published_heads text[] NOT NULL,
      published_by_issuer text NOT NULL,
      published_by_subject text NOT NULL,
      first_published_at timestamptz NOT NULL,
      published_at timestamptz NOT NULL
    )`,
    `CREATE INDEX events_event_date_idx ON events (event_date)`,
    `CREATE TRIGGER events_publish_times BEFORE INSERT OR UPDATE ON events
      FOR EACH ROW EXECUTE FUNCTION set_publish_times()`,
    // Materializes the draft as of the given heads (the version the user saw
    // when they clicked publish) into events.
    `CREATE FUNCTION publish_event(document_id uuid, heads text[], issuer text, subject text)
      RETURNS SETOF events LANGUAGE sql AS $$
      INSERT INTO events AS e
        (id, title, event_date, body, is_public, allow_guests, ask_dietary,
         published_heads, published_by_issuer, published_by_subject)
      SELECT d.id, c.content->>'title', (c.content->>'date')::date, c.content->>'body',
        (c.content->>'public')::boolean,
        (c.content->>'public')::boolean AND (c.content->>'guests')::boolean,
        (c.content->>'dietary')::boolean,
        -- Sorted like automerge_heads(), so the two can be compared.
        ARRAY(SELECT h FROM unnest(heads) AS h ORDER BY h), issuer, subject
      FROM documents d
      CROSS JOIN LATERAL (SELECT automerge_to_jsonb(d.draft, heads) AS content OFFSET 0) c
      WHERE d.id = document_id AND d.type = 'event'
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        event_date = EXCLUDED.event_date,
        body = EXCLUDED.body,
        is_public = EXCLUDED.is_public,
        allow_guests = EXCLUDED.allow_guests,
        ask_dietary = EXCLUDED.ask_dietary,
        published_heads = EXCLUDED.published_heads,
        published_by_issuer = EXCLUDED.published_by_issuer,
        published_by_subject = EXCLUDED.published_by_subject
      RETURNING e.*
    $$`,
  ),
  "0003_attendance": statements(
    // Who is coming to a published event: members by their account, guests
    // by name and email. Guests cancel with a token only they were given;
    // its hash is stored.
    `CREATE TABLE attendees (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
      user_issuer text,
      user_subject text,
      name text NOT NULL,
      email text,
      dietary text,
      cancel_token_hash text UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (
        (user_issuer IS NOT NULL AND user_subject IS NOT NULL AND cancel_token_hash IS NULL)
        OR (user_issuer IS NULL AND user_subject IS NULL
            AND email IS NOT NULL AND cancel_token_hash IS NOT NULL)
      )
    )`,
    `CREATE UNIQUE INDEX attendees_member_key ON attendees (event_id, user_issuer, user_subject)
      WHERE user_issuer IS NOT NULL`,
    `CREATE UNIQUE INDEX attendees_guest_email_key ON attendees (event_id, lower(email))
      WHERE user_issuer IS NULL`,
  ),
});
