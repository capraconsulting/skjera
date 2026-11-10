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
    // Materializes the draft as of the given heads (the version the user saw
    // when they clicked publish) into events.
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
    // Deleted rows leave a tombstone, so pulls can tell clients about them.
    `CREATE TABLE sync_deletes (
      table_name text NOT NULL,
      id uuid NOT NULL,
      xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
      deleted_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX sync_deletes_xid_idx ON sync_deletes (table_name, xid)`,
  ),
  "0005_sync_events": statements(),
  "0006_sync_attendees": statements(),
  "0007_document_summaries": statements(
    // What lists of documents show, copied out of the draft so they sync as
    // plain columns. Kept by the database whenever the draft is written.
    `ALTER TABLE documents
      ADD COLUMN title text NOT NULL DEFAULT '',
      ADD COLUMN event_date date,
      ADD COLUMN draft_heads text[] NOT NULL DEFAULT '{}'`,
    `UPDATE documents SET
      title = coalesce(draft::jsonb->>'title', ''),
      event_date = (draft::jsonb->>'date')::date,
      draft_heads = automerge_heads(draft)`,
  ),
  "0008_pg_automerge_0_2": statements(`
    DO $$ BEGIN
      -- A managed database may install the current extension as an admin.
      -- Avoid an ownership check when there is nothing to upgrade. If an
      -- upgrade is needed, its owner must still perform/authorize it.
      IF EXISTS (
        SELECT 1 FROM pg_extension installed
        JOIN pg_available_extensions available ON available.name = installed.extname
        WHERE installed.extname = 'pg_automerge'
          AND installed.extversion IS DISTINCT FROM available.default_version
      ) THEN
        ALTER EXTENSION pg_automerge UPDATE;
      END IF;
    END $$
  `),
  "0009_rich_body": statements(
    // The published body keeps its rich text structure: automerge_spans,
    // runs of text with their marks, and blocks (paragraphs, headings, list
    // items, images). Plain bodies published before become one run.
    `ALTER TABLE events ALTER COLUMN body TYPE jsonb USING
      CASE WHEN body = '' THEN '[]'::jsonb
      ELSE jsonb_build_array(jsonb_build_object('type', 'text', 'value', body)) END`,
  ),
  "0010_cover": statements(
    // The cover image: { src, alt }, or null.
    `ALTER TABLE events ADD COLUMN cover jsonb`,
  ),
  "0011_event_times": statements(
    // Times are stored in drafts as "2026-10-15T18:00+02:00[Europe/Oslo]":
    // the instant (with its offset), and the zone it was set in.
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
          `DROP TRIGGER IF EXISTS ${table}_sync_touch ON ${table}`,
          `DROP TRIGGER IF EXISTS ${table}_sync_tombstone ON ${table}`,
          `ALTER TABLE ${table} DROP COLUMN IF EXISTS xid`,
          `SELECT snapsync.track('${table}')`,
        ],
      ),
      `DROP TABLE IF EXISTS sync_deletes`,
      `DROP FUNCTION IF EXISTS sync_touch()`,
      `DROP FUNCTION IF EXISTS sync_tombstone()`,
    ),
  ),
  "0016_attendees_follow_events":
    statements(
      // Pulls page by each table's own transaction ids, so attendees change
      // when whether visitors may see them does: when their event's public
      // flag does. (Deleted events take their attendees, leaving tombstones.)
    ),
  "0017_reminders": statements(
    // Attendees are emailed the day before, unless the event says not to.
    `ALTER TABLE events ADD COLUMN send_reminders boolean NOT NULL DEFAULT true`,
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
    `DROP TRIGGER IF EXISTS events_publish_times ON events`,
    // Signups leave readers' copies with their event.
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
  ),
  "0021_attendee_limit": statements(
    // The most who can sign up; null: no limit. Signups are not touched
    // when it changes: a limit below those signed up takes nobody new.
    `ALTER TABLE events
      ADD COLUMN max_attendees integer CHECK (max_attendees > 0),
      ADD COLUMN hide_places_left boolean NOT NULL DEFAULT false`,
  ),
  "0022_streaming": statements(
    // Streamed events: where to follow, and whether each signup follows
    // online rather than comes in person. A choice counts only while the
    // event is streamed and is kept as given when it stops being.
    `ALTER TABLE events
      ADD COLUMN is_streamed boolean NOT NULL DEFAULT false,
      ADD COLUMN stream_link text`,
    `ALTER TABLE attendees ADD COLUMN online boolean NOT NULL DEFAULT false`,
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
  ),
  "0025_summary": statements(
    // What an event is, in a sentence or two: shown under its title, in
    // invitations, and when a link to the event is shared.
    `ALTER TABLE events ADD COLUMN summary text`,
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
  "0027_recurring": statements(
    // Recurring events move on to their next date when they have ended (see
    // Recurring.ts): every 1 to 7 days, weeks, months or years. Both null:
    // not recurring.
    `ALTER TABLE events
      ADD COLUMN repeat_every integer CHECK (repeat_every BETWEEN 1 AND 7),
      ADD COLUMN repeat_unit text CHECK (repeat_unit IN ('day', 'week', 'month', 'year')),
      ADD CHECK ((repeat_every IS NULL) = (repeat_unit IS NULL))`,
  ),
  "0028_email_texts": statements(
    // The emails' own subjects and texts, as of the published version: by
    // key (e.g. signedUpSubject, signedUpText); a key is there only when
    // something is written. Subjects are strings, texts are spans.
    `ALTER TABLE events ADD COLUMN email_texts jsonb NOT NULL DEFAULT '{}'`,
    // A subject is one line: line breaks and other control characters
    // become a space, then it is trimmed. Blank is none.
    // A text's spans, if the draft has the key and something is written:
    // some text that is not whitespace, or an image. Drafts from before have
    // no key, and automerge_spans is not asked for one.
  ),
  "0029_reminder_choice": statements(
    // Ticked reminders become «Standard», on only where guests can sign up;
    // unticked become «Av». Only the rows that change are written: every row
    // updated is pulled again by every client.
    `UPDATE events SET send_reminders = false WHERE send_reminders AND NOT allow_guests`,
  ),
  "0030_invitations": statements(
    // Who an organizer noted as invited to an event: a record only, nothing is
    // sent. Every event in the studio has one, published or not.
    `CREATE TABLE invitations (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      event_id uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
      name text CHECK (name IS NULL OR btrim(name) <> ''),
      email text NOT NULL CHECK (btrim(email) <> ''),
      invited_at timestamptz NOT NULL DEFAULT now()
    )`,
    // The same address once per event, whatever its case; also the index by event.
    `CREATE UNIQUE INDEX invitations_event_id_email_key ON invitations (event_id, lower(email))`,
  ),
  "0031_document_tags": statements(
    // The draft's tags, as written, so the studio can search its lists by them.
    `ALTER TABLE documents ADD COLUMN tags text[] NOT NULL DEFAULT '{}'`,
    // Fills the column for the drafts already there; updated_at is left as it is.
    `UPDATE documents SET
      tags = CASE jsonb_typeof(draft::jsonb->'tags')
        WHEN 'array' THEN ARRAY(
          SELECT tag FROM jsonb_array_elements_text(draft::jsonb->'tags')
            WITH ORDINALITY AS t (tag, n) ORDER BY n)
        ELSE '{}'::text[] END,
      draft_heads = automerge_heads(draft)`,
  ),
  "0032_first_published": statements(
    // When the event was first published, kept after it is unpublished: an
    // event can change team only until then.
    `ALTER TABLE documents ADD COLUMN first_published_at timestamptz`,
    // When an event is first published, its document says so, and is pulled again.
    // Events published before, unpublished ones too: their events row is kept.
    `UPDATE documents d SET first_published_at = e.first_published_at
      FROM events e WHERE e.id = d.id`,
  ),
  "0033_history": statements(
    // The name each person goes by, as the identity provider last gave it.
    `CREATE TABLE people (
      issuer text NOT NULL,
      subject text NOT NULL,
      name text NOT NULL CHECK (btrim(name) <> ''),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (issuer, subject)
    )`,
    // Every publishing of an event. No publisher: Skjera did it (the
    // recurring move).
    `CREATE TABLE event_publications (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      event_id uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
      heads text[] NOT NULL,
      published_at timestamptz NOT NULL DEFAULT now(),
      published_by_issuer text,
      published_by_subject text,
      CHECK ((published_by_issuer IS NULL) = (published_by_subject IS NULL))
    )`,
    `CREATE INDEX event_publications_event_id_idx ON event_publications (event_id, published_at)`,
    // The latest publishing of each event published before the log existed.
    `INSERT INTO event_publications (event_id, heads, published_at, published_by_issuer, published_by_subject)
      SELECT id, published_heads, published_at, published_by_issuer, published_by_subject
      FROM events`,
  ),
  "0034_sales_events": statements(
    // Sent to HubSpot as a Marketing Event, with its sign-ups: only for a
    // public event open to guests that has the setting on.
    `ALTER TABLE events ADD COLUMN sales_event boolean NOT NULL DEFAULT false`,
    // The Marketing Event's type as written; none: «Frokostseminar».
    `ALTER TABLE events ADD COLUMN sales_event_type text`,
    // A guest's job title on a sales event's sign-up form, sent to HubSpot.
    `ALTER TABLE attendees ADD COLUMN job_title text`,
  ),
  "0035_ad_source": statements(
    // The ad someone came from, from the address of the event's page: the
    // values it had by name. None: null, never a JSON null.
    `ALTER TABLE attendees ADD COLUMN ad_source jsonb`,
  ),
  "0036_marketing_consent": statements(
    // Whether they asked for invitations and the newsletter when signing up.
    `ALTER TABLE attendees ADD COLUMN marketing_consent boolean NOT NULL DEFAULT false`,
  ),
  "0037_organizer_emails": statements(
    // What an organizer wrote to everyone signed up to an event, kept for the
    // event's list of emails sent; the event's mailer reads it when it sends.
    `CREATE TABLE organizer_emails (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
      subject text NOT NULL CHECK (btrim(subject) <> ''),
      text text NOT NULL CHECK (btrim(text) <> ''),
      sent_by_name text,
      sent_by_email text,
      recipients integer NOT NULL CHECK (recipients >= 0),
      sent_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX organizer_emails_event_id_idx ON organizer_emails (event_id)`,
  ),
});
