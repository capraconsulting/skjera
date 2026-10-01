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

/** Makes a table syncable: see the 0004_sync migration. */
const syncTable = (table: string) => [
  `ALTER TABLE ${table} ADD COLUMN xid xid8 NOT NULL DEFAULT pg_current_xact_id()`,
  `CREATE INDEX ${table}_xid_idx ON ${table} (xid)`,
  `CREATE TRIGGER ${table}_sync_touch BEFORE UPDATE ON ${table}
    FOR EACH ROW EXECUTE FUNCTION sync_touch()`,
  `CREATE TRIGGER ${table}_sync_tombstone AFTER DELETE ON ${table}
    FOR EACH ROW EXECUTE FUNCTION sync_tombstone()`,
];

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
  "0004_sync": statements(
    // Clients keep copies of tables and pull what changed since a snapshot
    // (see Sync.ts). Each synced row carries the id of the transaction that
    // last wrote it; a snapshot tells which transactions a pull has seen.
    `CREATE FUNCTION sync_touch() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      NEW.xid := pg_current_xact_id();
      RETURN NEW;
    END
    $$`,
    // Deleted rows leave a tombstone, so pulls can tell clients about them.
    `CREATE TABLE sync_deletes (
      table_name text NOT NULL,
      id uuid NOT NULL,
      xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
      deleted_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX sync_deletes_xid_idx ON sync_deletes (table_name, xid)`,
    `CREATE FUNCTION sync_tombstone() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO sync_deletes (table_name, id) VALUES (TG_TABLE_NAME, OLD.id);
      RETURN OLD;
    END
    $$`,
    ...syncTable("teams"),
    ...syncTable("documents"),
  ),
  "0005_sync_events": statements(...syncTable("events")),
  "0006_sync_attendees": statements(...syncTable("attendees")),
  "0007_document_summaries": statements(
    // What lists of documents show, copied out of the draft so they sync as
    // plain columns. Kept by the database whenever the draft is written.
    `ALTER TABLE documents
      ADD COLUMN title text NOT NULL DEFAULT '',
      ADD COLUMN event_date date,
      ADD COLUMN draft_heads text[] NOT NULL DEFAULT '{}'`,
    `CREATE FUNCTION documents_summarize() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      content jsonb := NEW.draft::jsonb;
    BEGIN
      NEW.title := coalesce(content->>'title', '');
      NEW.event_date := (content->>'date')::date;
      -- Sorted, like published_heads, so the two can be compared.
      NEW.draft_heads := automerge_heads(NEW.draft);
      RETURN NEW;
    END
    $$`,
    `CREATE TRIGGER documents_summarize BEFORE INSERT OR UPDATE OF draft ON documents
      FOR EACH ROW EXECUTE FUNCTION documents_summarize()`,
    `UPDATE documents SET draft = draft`,
  ),
  // pg_automerge 0.2.0 adds automerge_spans, for rich text; the image must
  // have it (see compose.yml).
  "0008_pg_automerge_0_2": statements(`ALTER EXTENSION pg_automerge UPDATE`),
  "0009_rich_body": statements(
    // The published body keeps its rich text structure: automerge_spans,
    // runs of text with their marks, and blocks (paragraphs, headings, list
    // items, images). Plain bodies published before become one run.
    `ALTER TABLE events ALTER COLUMN body TYPE jsonb USING
      CASE WHEN body = '' THEN '[]'::jsonb
      ELSE jsonb_build_array(jsonb_build_object('type', 'text', 'value', body)) END`,
    `CREATE OR REPLACE FUNCTION publish_event(document_id uuid, heads text[], issuer text, subject text)
      RETURNS SETOF events LANGUAGE sql AS $$
      INSERT INTO events AS e
        (id, title, event_date, body, is_public, allow_guests, ask_dietary,
         published_heads, published_by_issuer, published_by_subject)
      SELECT d.id, c.content->>'title', (c.content->>'date')::date, automerge_spans(d.draft, '{body}', heads),
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
  "0010_cover": statements(
    // The cover image: { src, alt }, or null.
    `ALTER TABLE events ADD COLUMN cover jsonb`,
    `CREATE OR REPLACE FUNCTION publish_event(document_id uuid, heads text[], issuer text, subject text)
      RETURNS SETOF events LANGUAGE sql AS $$
      INSERT INTO events AS e
        (id, title, event_date, body, cover, is_public, allow_guests, ask_dietary,
         published_heads, published_by_issuer, published_by_subject)
      SELECT d.id, c.content->>'title', (c.content->>'date')::date, automerge_spans(d.draft, '{body}', heads),
        c.content->'cover',
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
        cover = EXCLUDED.cover,
        is_public = EXCLUDED.is_public,
        allow_guests = EXCLUDED.allow_guests,
        ask_dietary = EXCLUDED.ask_dietary,
        published_heads = EXCLUDED.published_heads,
        published_by_issuer = EXCLUDED.published_by_issuer,
        published_by_subject = EXCLUDED.published_by_subject
      RETURNING e.*
    $$`,
  ),
  "0011_event_times": statements(
    // Times are stored in drafts as "2026-10-15T18:00+02:00[Europe/Oslo]":
    // the instant (with its offset), and the zone it was set in.
    `CREATE FUNCTION zoned_instant(value text) RETURNS timestamptz
      LANGUAGE sql STABLE RETURN regexp_replace(value, '\\[[^]]*\\]$', '')::timestamptz`,
    `CREATE FUNCTION zoned_zone(value text) RETURNS text
      LANGUAGE sql IMMUTABLE RETURN substring(value from '\\[([^]]*)\\]$')`,
    // Events had a date only. Nothing published with one is kept.
    `DELETE FROM events`,
    `ALTER TABLE events
      DROP COLUMN event_date,
      ADD COLUMN starts_at timestamptz NOT NULL,
      ADD COLUMN ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
      -- Signing up and cancelling close then; at the start when null.
      ADD COLUMN signup_deadline timestamptz CHECK (signup_deadline <= starts_at),
      -- The zone the times were set in, e.g. Europe/Oslo, to show them in.
      ADD COLUMN time_zone text NOT NULL`,
    `CREATE INDEX events_starts_at_idx ON events (starts_at)`,
    `ALTER TABLE documents
      DROP COLUMN event_date,
      ADD COLUMN starts_at timestamptz,
      ADD COLUMN time_zone text`,
    `CREATE OR REPLACE FUNCTION documents_summarize() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      content jsonb := NEW.draft::jsonb;
    BEGIN
      NEW.title := coalesce(content->>'title', '');
      NEW.starts_at := zoned_instant(content->>'start');
      NEW.time_zone := zoned_zone(content->>'start');
      -- Sorted, like published_heads, so the two can be compared.
      NEW.draft_heads := automerge_heads(NEW.draft);
      RETURN NEW;
    END
    $$`,
    `CREATE OR REPLACE FUNCTION publish_event(document_id uuid, heads text[], issuer text, subject text)
      RETURNS SETOF events LANGUAGE sql AS $$
      INSERT INTO events AS e
        (id, title, starts_at, ends_at, signup_deadline, time_zone, body, cover,
         is_public, allow_guests, ask_dietary,
         published_heads, published_by_issuer, published_by_subject)
      SELECT d.id, c.content->>'title',
        zoned_instant(c.content->>'start'), zoned_instant(c.content->>'end'),
        zoned_instant(c.content->>'deadline'), zoned_zone(c.content->>'start'),
        automerge_spans(d.draft, '{body}', heads), c.content->'cover',
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
        starts_at = EXCLUDED.starts_at,
        ends_at = EXCLUDED.ends_at,
        signup_deadline = EXCLUDED.signup_deadline,
        time_zone = EXCLUDED.time_zone,
        body = EXCLUDED.body,
        cover = EXCLUDED.cover,
        is_public = EXCLUDED.is_public,
        allow_guests = EXCLUDED.allow_guests,
        ask_dietary = EXCLUDED.ask_dietary,
        published_heads = EXCLUDED.published_heads,
        published_by_issuer = EXCLUDED.published_by_issuer,
        published_by_subject = EXCLUDED.published_by_subject
      RETURNING e.*
    $$`,
  ),
  "0012_food_and_questions": statements(
    `ALTER TABLE events
      -- What or where people eat, when food is served (ask_dietary).
      ADD COLUMN food text NOT NULL DEFAULT '',
      -- Dietary preferences are asked until then; until sign-up closes if null.
      ADD COLUMN food_deadline timestamptz
        CHECK (food_deadline <= coalesce(signup_deadline, starts_at)),
      -- Asked of everyone signing up (see Question in Model.ts).
      ADD COLUMN questions jsonb NOT NULL DEFAULT '[]'`,
    // In the words asked and picked: [{ question, answer }].
    `ALTER TABLE attendees ADD COLUMN answers jsonb NOT NULL DEFAULT '[]'`,
    `CREATE OR REPLACE FUNCTION publish_event(document_id uuid, heads text[], issuer text, subject text)
      RETURNS SETOF events LANGUAGE sql AS $$
      INSERT INTO events AS e
        (id, title, starts_at, ends_at, signup_deadline, time_zone, body, cover,
         is_public, allow_guests, ask_dietary, food, food_deadline, questions,
         published_heads, published_by_issuer, published_by_subject)
      SELECT d.id, c.content->>'title',
        zoned_instant(c.content->>'start'), zoned_instant(c.content->>'end'),
        zoned_instant(c.content->>'deadline'), zoned_zone(c.content->>'start'),
        automerge_spans(d.draft, '{body}', heads), c.content->'cover',
        (c.content->>'public')::boolean,
        (c.content->>'public')::boolean AND (c.content->>'guests')::boolean,
        (c.content->>'dietary')::boolean,
        c.content->>'food', zoned_instant(c.content->>'foodDeadline'),
        c.content->'questions',
        -- Sorted like automerge_heads(), so the two can be compared.
        ARRAY(SELECT h FROM unnest(heads) AS h ORDER BY h), issuer, subject
      FROM documents d
      CROSS JOIN LATERAL (SELECT automerge_to_jsonb(d.draft, heads) AS content OFFSET 0) c
      WHERE d.id = document_id AND d.type = 'event'
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        starts_at = EXCLUDED.starts_at,
        ends_at = EXCLUDED.ends_at,
        signup_deadline = EXCLUDED.signup_deadline,
        time_zone = EXCLUDED.time_zone,
        body = EXCLUDED.body,
        cover = EXCLUDED.cover,
        is_public = EXCLUDED.is_public,
        allow_guests = EXCLUDED.allow_guests,
        ask_dietary = EXCLUDED.ask_dietary,
        food = EXCLUDED.food,
        food_deadline = EXCLUDED.food_deadline,
        questions = EXCLUDED.questions,
        published_heads = EXCLUDED.published_heads,
        published_by_issuer = EXCLUDED.published_by_issuer,
        published_by_subject = EXCLUDED.published_by_subject
      RETURNING e.*
    $$`,
  ),
  "0013_attendee_changes": statements(
    // When the signup's answers or dietary preferences last changed.
    `ALTER TABLE attendees ADD COLUMN changed_at timestamptz NOT NULL DEFAULT now()`,
  ),
});
