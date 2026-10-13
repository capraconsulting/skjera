import * as Snapsync from "@skjera/snapsync/server";
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
  "0014_tags": statements(
    `ALTER TABLE events ADD COLUMN tags text[] NOT NULL DEFAULT '{}'`,
    // Every tag published events have had, once, ignoring case: only to
    // suggest when tagging. Kept by publishing (below); never removed.
    `CREATE TABLE tags (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX tags_name_key ON tags (lower(name))`,
    ...syncTable("tags"),
    `CREATE FUNCTION events_collect_tags() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO tags (name)
        SELECT DISTINCT ON (lower(tag)) tag FROM unnest(NEW.tags) AS tag
        ON CONFLICT (lower(name)) DO NOTHING;
      RETURN NULL;
    END
    $$`,
    `CREATE TRIGGER events_collect_tags AFTER INSERT OR UPDATE OF tags ON events
      FOR EACH ROW EXECUTE FUNCTION events_collect_tags()`,
    `CREATE OR REPLACE FUNCTION publish_event(document_id uuid, heads text[], issuer text, subject text)
      RETURNS SETOF events LANGUAGE sql AS $$
      INSERT INTO events AS e
        (id, title, starts_at, ends_at, signup_deadline, time_zone, body, cover,
         is_public, allow_guests, ask_dietary, food, food_deadline, questions, tags,
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
        -- Each once, ignoring case, as first written.
        ARRAY(
          SELECT tag FROM (
            SELECT DISTINCT ON (lower(tag)) tag, n
            FROM jsonb_array_elements_text(c.content->'tags') WITH ORDINALITY AS t(tag, n)
            ORDER BY lower(tag), n
          ) firsts ORDER BY n
        ),
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
        tags = EXCLUDED.tags,
        published_heads = EXCLUDED.published_heads,
        published_by_issuer = EXCLUDED.published_by_issuer,
        published_by_subject = EXCLUDED.published_by_subject
      RETURNING e.*
    $$`,
  ),
  "0015_snapsync": Effect.andThen(
    // Syncing moves to snapsync (packages/snapsync), which also prunes
    // tombstones and starts clients over after a restore. Its tokens differ
    // from the snapshots before: every client starts over. Installed by
    // the app, not as an extension, so the database needs nothing of ours.
    Snapsync.install,
    statements(
      ...["teams", "documents", "events", "attendees", "tags"].flatMap(
        (table) => [
          `DROP TRIGGER ${table}_sync_touch ON ${table}`,
          `DROP TRIGGER ${table}_sync_tombstone ON ${table}`,
          `ALTER TABLE ${table} DROP COLUMN xid`,
          `SELECT snapsync.track('${table}')`,
        ],
      ),
      `DROP TABLE sync_deletes`,
      `DROP FUNCTION sync_touch()`,
      `DROP FUNCTION sync_tombstone()`,
    ),
  ),
  "0016_attendees_follow_events": statements(
    // Pulls page by each table's own transaction ids, so attendees change
    // when whether visitors may see them does: when their event's public
    // flag does. (Deleted events take their attendees, leaving tombstones.)
    `CREATE FUNCTION events_touch_attendees() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE attendees SET id = id WHERE event_id = NEW.id;
      RETURN NULL;
    END
    $$`,
    `CREATE TRIGGER events_touch_attendees AFTER UPDATE OF is_public ON events
      FOR EACH ROW WHEN (OLD.is_public IS DISTINCT FROM NEW.is_public)
      EXECUTE FUNCTION events_touch_attendees()`,
  ),
  "0017_reminders": statements(
    // Attendees are emailed the day before, unless the event says not to.
    `ALTER TABLE events ADD COLUMN send_reminders boolean NOT NULL DEFAULT true`,
    `CREATE OR REPLACE FUNCTION publish_event(document_id uuid, heads text[], issuer text, subject text)
      RETURNS SETOF events LANGUAGE sql AS $$
      INSERT INTO events AS e
        (id, title, starts_at, ends_at, signup_deadline, time_zone, body, cover,
         is_public, allow_guests, ask_dietary, food, food_deadline, questions, tags,
         send_reminders,
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
        -- Each once, ignoring case, as first written.
        ARRAY(
          SELECT tag FROM (
            SELECT DISTINCT ON (lower(tag)) tag, n
            FROM jsonb_array_elements_text(c.content->'tags') WITH ORDINALITY AS t(tag, n)
            ORDER BY lower(tag), n
          ) firsts ORDER BY n
        ),
        -- On unless turned off: drafts from before have no such field.
        coalesce((c.content->>'reminders')::boolean, true),
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
        tags = EXCLUDED.tags,
        send_reminders = EXCLUDED.send_reminders,
        published_heads = EXCLUDED.published_heads,
        published_by_issuer = EXCLUDED.published_by_issuer,
        published_by_subject = EXCLUDED.published_by_subject
      RETURNING e.*
    $$`,
  ),
  "0018_soft_delete": statements(
    // Deleting a document keeps it, and its published version and signups,
    // marked deleted: everything else treats it as gone. (A published
    // event's attendees are told it's cancelled.)
    `ALTER TABLE documents
      ADD COLUMN deleted_at timestamptz,
      ADD COLUMN deleted_by_issuer text,
      ADD COLUMN deleted_by_subject text`,
    `ALTER TABLE events ADD COLUMN deleted_at timestamptz`,
    // Publishing sets the publish times, not other changes to the row.
    `DROP TRIGGER events_publish_times ON events`,
    `CREATE TRIGGER events_publish_times BEFORE INSERT OR UPDATE OF published_heads ON events
      FOR EACH ROW EXECUTE FUNCTION set_publish_times()`,
    // Signups leave readers' copies with their event.
    `DROP TRIGGER events_touch_attendees ON events`,
    `CREATE TRIGGER events_touch_attendees AFTER UPDATE OF is_public, deleted_at ON events
      FOR EACH ROW WHEN (OLD.is_public IS DISTINCT FROM NEW.is_public
        OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
      EXECUTE FUNCTION events_touch_attendees()`,
  ),
  "0019_attendee_locale": statements(
    // The language each signed up in ("en", "nb", "nn"): emails to them are
    // in it. Null: the site's (SITE_LOCALE).
    `ALTER TABLE attendees ADD COLUMN locale text`,
  ),
  "0020_place": statements(
    // Where it is, as written. Null: published before events had a place.
    // A blank place is refused; null is let through, and so are updates of
    // such rows (soft delete).
    `ALTER TABLE events ADD COLUMN place text CHECK (btrim(place) <> '')`,
    `CREATE OR REPLACE FUNCTION publish_event(document_id uuid, heads text[], issuer text, subject text)
      RETURNS SETOF events LANGUAGE sql AS $$
      INSERT INTO events AS e
        (id, title, starts_at, ends_at, signup_deadline, time_zone, body, cover,
         is_public, allow_guests, ask_dietary, food, food_deadline, questions, tags,
         send_reminders, place,
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
        -- Each once, ignoring case, as first written.
        ARRAY(
          SELECT tag FROM (
            SELECT DISTINCT ON (lower(tag)) tag, n
            FROM jsonb_array_elements_text(c.content->'tags') WITH ORDINALITY AS t(tag, n)
            ORDER BY lower(tag), n
          ) firsts ORDER BY n
        ),
        -- On unless turned off: drafts from before have no such field.
        coalesce((c.content->>'reminders')::boolean, true),
        -- Stored as written. Drafts from before have none: null.
        c.content->>'place',
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
        tags = EXCLUDED.tags,
        send_reminders = EXCLUDED.send_reminders,
        place = EXCLUDED.place,
        published_heads = EXCLUDED.published_heads,
        published_by_issuer = EXCLUDED.published_by_issuer,
        published_by_subject = EXCLUDED.published_by_subject
      RETURNING e.*
    $$`,
  ),
  "0021_attendee_limit": statements(
    // The most who can sign up; null: no limit. Signups are not touched
    // when it changes: a limit below those signed up takes nobody new.
    `ALTER TABLE events
      ADD COLUMN max_attendees integer CHECK (max_attendees > 0),
      ADD COLUMN hide_places_left boolean NOT NULL DEFAULT false`,
    `CREATE OR REPLACE FUNCTION publish_event(document_id uuid, heads text[], issuer text, subject text)
      RETURNS SETOF events LANGUAGE sql AS $$
      INSERT INTO events AS e
        (id, title, starts_at, ends_at, signup_deadline, time_zone, body, cover,
         is_public, allow_guests, ask_dietary, food, food_deadline, questions, tags,
         send_reminders, place, max_attendees, hide_places_left,
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
        -- Each once, ignoring case, as first written.
        ARRAY(
          SELECT tag FROM (
            SELECT DISTINCT ON (lower(tag)) tag, n
            FROM jsonb_array_elements_text(c.content->'tags') WITH ORDINALITY AS t(tag, n)
            ORDER BY lower(tag), n
          ) firsts ORDER BY n
        ),
        -- On unless turned off: drafts from before have no such field.
        coalesce((c.content->>'reminders')::boolean, true),
        -- Stored as written. Drafts from before have none: null.
        c.content->>'place',
        -- Through numeric: a whole number stored as a float reads "30.0".
        (c.content->>'maxAttendees')::numeric::integer,
        -- Shown unless hidden: drafts from before have no such field.
        coalesce((c.content->>'hidePlacesLeft')::boolean, false),
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
        tags = EXCLUDED.tags,
        send_reminders = EXCLUDED.send_reminders,
        place = EXCLUDED.place,
        max_attendees = EXCLUDED.max_attendees,
        hide_places_left = EXCLUDED.hide_places_left,
        published_heads = EXCLUDED.published_heads,
        published_by_issuer = EXCLUDED.published_by_issuer,
        published_by_subject = EXCLUDED.published_by_subject
      RETURNING e.*
    $$`,
  ),
  "0022_streaming": statements(
    // Streamed events: where to follow, and whether each signup follows
    // online rather than comes in person. A choice counts only while the
    // event is streamed and is kept as given when it stops being.
    `ALTER TABLE events
      ADD COLUMN is_streamed boolean NOT NULL DEFAULT false,
      ADD COLUMN stream_link text`,
    `ALTER TABLE attendees ADD COLUMN online boolean NOT NULL DEFAULT false`,
    `CREATE OR REPLACE FUNCTION publish_event(document_id uuid, heads text[], issuer text, subject text)
      RETURNS SETOF events LANGUAGE sql AS $$
      INSERT INTO events AS e
        (id, title, starts_at, ends_at, signup_deadline, time_zone, body, cover,
         is_public, allow_guests, ask_dietary, food, food_deadline, questions, tags,
         send_reminders, place, max_attendees, hide_places_left,
         is_streamed, stream_link,
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
        -- Each once, ignoring case, as first written.
        ARRAY(
          SELECT tag FROM (
            SELECT DISTINCT ON (lower(tag)) tag, n
            FROM jsonb_array_elements_text(c.content->'tags') WITH ORDINALITY AS t(tag, n)
            ORDER BY lower(tag), n
          ) firsts ORDER BY n
        ),
        -- On unless turned off: drafts from before have no such field.
        coalesce((c.content->>'reminders')::boolean, true),
        -- Stored as written. Drafts from before have none: null.
        c.content->>'place',
        -- Through numeric: a whole number stored as a float reads "30.0".
        (c.content->>'maxAttendees')::numeric::integer,
        -- Shown unless hidden: drafts from before have no such field.
        coalesce((c.content->>'hidePlacesLeft')::boolean, false),
        -- Streamed unless missing: drafts from before have no such field.
        coalesce((c.content->>'streamed')::boolean, false),
        -- Only while streamed; trimmed as the check trims, blank is none.
        CASE WHEN coalesce((c.content->>'streamed')::boolean, false)
          THEN nullif(regexp_replace(c.content->>'streamLink', '^\\s+|\\s+$', '', 'g'), '')
        END,
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
        tags = EXCLUDED.tags,
        send_reminders = EXCLUDED.send_reminders,
        place = EXCLUDED.place,
        max_attendees = EXCLUDED.max_attendees,
        hide_places_left = EXCLUDED.hide_places_left,
        is_streamed = EXCLUDED.is_streamed,
        stream_link = EXCLUDED.stream_link,
        published_heads = EXCLUDED.published_heads,
        published_by_issuer = EXCLUDED.published_by_issuer,
        published_by_subject = EXCLUDED.published_by_subject
      RETURNING e.*
    $$`,
  ),
  "0023_guest_contact": statements(
    // A guest's phone number and company, both optional: members aren't
    // asked. Kept as typed, trimmed; nothing checks a number is real.
    `ALTER TABLE attendees ADD COLUMN phone text, ADD COLUMN company text`,
  ),
  "0024_team_logos": statements(
    // A team's logos, for the light theme and the dark: uploaded images
    // (/api/images/…), each optional. The site shows a team as the organizer
    // of its events, by its logo or its name.
    `ALTER TABLE teams ADD COLUMN logo text, ADD COLUMN logo_dark text`,
    // Events are pulled with their team's name and logos (see Sync.ts): a
    // change to those touches the team's events, so readers pull them again.
    `CREATE FUNCTION teams_touch_events() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE events SET id = id
        WHERE id IN (SELECT id FROM documents WHERE team_id = NEW.id);
      RETURN NULL;
    END
    $$`,
    `CREATE TRIGGER teams_touch_events AFTER UPDATE OF name, logo, logo_dark ON teams
      FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name
        OR OLD.logo IS DISTINCT FROM NEW.logo
        OR OLD.logo_dark IS DISTINCT FROM NEW.logo_dark)
      EXECUTE FUNCTION teams_touch_events()`,
  ),
  "0025_summary": statements(
    // What an event is, in a sentence or two: shown under its title, in
    // invitations, and when a link to the event is shared.
    `ALTER TABLE events ADD COLUMN summary text`,
    `CREATE OR REPLACE FUNCTION publish_event(document_id uuid, heads text[], issuer text, subject text)
      RETURNS SETOF events LANGUAGE sql AS $$
      INSERT INTO events AS e
        (id, title, summary, starts_at, ends_at, signup_deadline, time_zone, body, cover,
         is_public, allow_guests, ask_dietary, food, food_deadline, questions, tags,
         send_reminders, place, max_attendees, hide_places_left,
         is_streamed, stream_link,
         published_heads, published_by_issuer, published_by_subject)
      SELECT d.id, c.content->>'title',
        -- Stored trimmed; blank, or drafts from before, are none.
        nullif(regexp_replace(c.content->>'summary', '^\\s+|\\s+$', '', 'g'), ''),
        zoned_instant(c.content->>'start'), zoned_instant(c.content->>'end'),
        zoned_instant(c.content->>'deadline'), zoned_zone(c.content->>'start'),
        automerge_spans(d.draft, '{body}', heads), c.content->'cover',
        (c.content->>'public')::boolean,
        (c.content->>'public')::boolean AND (c.content->>'guests')::boolean,
        (c.content->>'dietary')::boolean,
        c.content->>'food', zoned_instant(c.content->>'foodDeadline'),
        c.content->'questions',
        -- Each once, ignoring case, as first written.
        ARRAY(
          SELECT tag FROM (
            SELECT DISTINCT ON (lower(tag)) tag, n
            FROM jsonb_array_elements_text(c.content->'tags') WITH ORDINALITY AS t(tag, n)
            ORDER BY lower(tag), n
          ) firsts ORDER BY n
        ),
        -- On unless turned off: drafts from before have no such field.
        coalesce((c.content->>'reminders')::boolean, true),
        -- Stored as written. Drafts from before have none: null.
        c.content->>'place',
        -- Through numeric: a whole number stored as a float reads "30.0".
        (c.content->>'maxAttendees')::numeric::integer,
        -- Shown unless hidden: drafts from before have no such field.
        coalesce((c.content->>'hidePlacesLeft')::boolean, false),
        -- Streamed unless missing: drafts from before have no such field.
        coalesce((c.content->>'streamed')::boolean, false),
        -- Only while streamed; trimmed as the check trims, blank is none.
        CASE WHEN coalesce((c.content->>'streamed')::boolean, false)
          THEN nullif(regexp_replace(c.content->>'streamLink', '^\\s+|\\s+$', '', 'g'), '')
        END,
        -- Sorted like automerge_heads(), so the two can be compared.
        ARRAY(SELECT h FROM unnest(heads) AS h ORDER BY h), issuer, subject
      FROM documents d
      CROSS JOIN LATERAL (SELECT automerge_to_jsonb(d.draft, heads) AS content OFFSET 0) c
      WHERE d.id = document_id AND d.type = 'event'
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
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
        tags = EXCLUDED.tags,
        send_reminders = EXCLUDED.send_reminders,
        place = EXCLUDED.place,
        max_attendees = EXCLUDED.max_attendees,
        hide_places_left = EXCLUDED.hide_places_left,
        is_streamed = EXCLUDED.is_streamed,
        stream_link = EXCLUDED.stream_link,
        published_heads = EXCLUDED.published_heads,
        published_by_issuer = EXCLUDED.published_by_issuer,
        published_by_subject = EXCLUDED.published_by_subject
      RETURNING e.*
    $$`,
  ),
  "0026_dietary_preferences": statements(
    // What people can't eat, for the event, with nothing that says who wrote
    // it or when. Random ids (not uuidv7, which holds the time), so the
    // order they were given can't be matched to the order of signups.
    `CREATE TABLE dietary_preferences (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
      text text NOT NULL CHECK (btrim(text) <> '')
    )`,
    `CREATE INDEX dietary_preferences_event_id_idx ON dietary_preferences (event_id)`,
    // Those given on signups so far move to their events.
    `INSERT INTO dietary_preferences (event_id, text)
      SELECT event_id, btrim(dietary) FROM attendees
      WHERE dietary IS NOT NULL AND btrim(dietary) <> ''`,
    `ALTER TABLE attendees DROP COLUMN dietary`,
  ),
  "0027_email_texts": statements(
    // The emails' own subjects and texts, as of the published version: by
    // key (e.g. signedUpSubject, signedUpText); a key is there only when
    // something is written. Subjects are strings, texts are spans.
    `ALTER TABLE events ADD COLUMN email_texts jsonb NOT NULL DEFAULT '{}'`,
    // A subject is one line: line breaks and other control characters
    // become a space, then it is trimmed. Blank is none.
    `CREATE FUNCTION email_subject(subject text) RETURNS text
      LANGUAGE sql IMMUTABLE AS $$
      SELECT nullif(btrim(regexp_replace(subject, '[[:cntrl:]]+', ' ', 'g')), '')
    $$`,
    // A text's spans, if the draft has the key and something is written:
    // some text that is not whitespace, or an image. Drafts from before have
    // no key, and automerge_spans is not asked for one.
    `CREATE FUNCTION email_text_spans(doc automerge, field text, heads text[], content jsonb)
      RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
      DECLARE spans jsonb;
      BEGIN
        IF NOT content ? field THEN
          RETURN NULL;
        END IF;
        spans := automerge_spans(doc, ARRAY[field], heads);
        IF EXISTS (
          SELECT 1 FROM jsonb_array_elements(spans) AS span
          WHERE (span->>'type' = 'text' AND span->>'value' ~ '[^[:space:]]')
            OR (span->>'type' = 'block' AND span->'value'->>'type' = 'image')
        ) THEN
          RETURN spans;
        END IF;
        RETURN NULL;
      END
    $$`,
    `CREATE OR REPLACE FUNCTION publish_event(document_id uuid, heads text[], issuer text, subject text)
      RETURNS SETOF events LANGUAGE sql AS $$
      INSERT INTO events AS e
        (id, title, summary, starts_at, ends_at, signup_deadline, time_zone, body, cover,
         is_public, allow_guests, ask_dietary, food, food_deadline, questions, tags,
         send_reminders, place, max_attendees, hide_places_left,
         is_streamed, stream_link, email_texts,
         published_heads, published_by_issuer, published_by_subject)
      SELECT d.id, c.content->>'title',
        -- Stored trimmed; blank, or drafts from before, are none.
        nullif(regexp_replace(c.content->>'summary', '^\\s+|\\s+$', '', 'g'), ''),
        zoned_instant(c.content->>'start'), zoned_instant(c.content->>'end'),
        zoned_instant(c.content->>'deadline'), zoned_zone(c.content->>'start'),
        automerge_spans(d.draft, '{body}', heads), c.content->'cover',
        (c.content->>'public')::boolean,
        (c.content->>'public')::boolean AND (c.content->>'guests')::boolean,
        (c.content->>'dietary')::boolean,
        c.content->>'food', zoned_instant(c.content->>'foodDeadline'),
        c.content->'questions',
        -- Each once, ignoring case, as first written.
        ARRAY(
          SELECT tag FROM (
            SELECT DISTINCT ON (lower(tag)) tag, n
            FROM jsonb_array_elements_text(c.content->'tags') WITH ORDINALITY AS t(tag, n)
            ORDER BY lower(tag), n
          ) firsts ORDER BY n
        ),
        -- On unless turned off: drafts from before have no such field.
        coalesce((c.content->>'reminders')::boolean, true),
        -- Stored as written. Drafts from before have none: null.
        c.content->>'place',
        -- Through numeric: a whole number stored as a float reads "30.0".
        (c.content->>'maxAttendees')::numeric::integer,
        -- Shown unless hidden: drafts from before have no such field.
        coalesce((c.content->>'hidePlacesLeft')::boolean, false),
        -- Streamed unless missing: drafts from before have no such field.
        coalesce((c.content->>'streamed')::boolean, false),
        -- Only while streamed; trimmed as the check trims, blank is none.
        CASE WHEN coalesce((c.content->>'streamed')::boolean, false)
          THEN nullif(regexp_replace(c.content->>'streamLink', '^\\s+|\\s+$', '', 'g'), '')
        END,
        -- The emails' own subjects and texts; none is left out.
        (SELECT coalesce(jsonb_object_agg(email.key, email.value), '{}')
          FROM (VALUES
            ('signedUpSubject', to_jsonb(email_subject(c.content->>'signedUpSubject'))),
            ('signedUpText', email_text_spans(d.draft, 'signedUpText', heads, c.content)),
            ('signupCancelledSubject', to_jsonb(email_subject(c.content->>'signupCancelledSubject'))),
            ('signupCancelledText', email_text_spans(d.draft, 'signupCancelledText', heads, c.content)),
            ('eventChangedSubject', to_jsonb(email_subject(c.content->>'eventChangedSubject'))),
            ('eventChangedText', email_text_spans(d.draft, 'eventChangedText', heads, c.content)),
            ('eventCancelledSubject', to_jsonb(email_subject(c.content->>'eventCancelledSubject'))),
            ('eventCancelledText', email_text_spans(d.draft, 'eventCancelledText', heads, c.content))
          ) AS email(key, value)
          WHERE email.value IS NOT NULL),
        -- Sorted like automerge_heads(), so the two can be compared.
        ARRAY(SELECT h FROM unnest(heads) AS h ORDER BY h), issuer, subject
      FROM documents d
      CROSS JOIN LATERAL (SELECT automerge_to_jsonb(d.draft, heads) AS content OFFSET 0) c
      WHERE d.id = document_id AND d.type = 'event'
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
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
        tags = EXCLUDED.tags,
        send_reminders = EXCLUDED.send_reminders,
        place = EXCLUDED.place,
        max_attendees = EXCLUDED.max_attendees,
        hide_places_left = EXCLUDED.hide_places_left,
        is_streamed = EXCLUDED.is_streamed,
        stream_link = EXCLUDED.stream_link,
        email_texts = EXCLUDED.email_texts,
        published_heads = EXCLUDED.published_heads,
        published_by_issuer = EXCLUDED.published_by_issuer,
        published_by_subject = EXCLUDED.published_by_subject
      RETURNING e.*
    $$`,
  ),
});
