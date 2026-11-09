import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import {
  organizerEmails,
  repeatDefaults,
  salesEventFields,
} from "../events/ContentTypes.ts";
import { channel } from "../events/sync/DocumentEvents.ts";

const publishedOrganizerEmailFields = organizerEmails.flatMap(
  ({ subject, text }) => [subject, text],
);
const publishedOrganizerEmailValues = organizerEmails
  .flatMap(({ subject, text }) => [
    `('${subject}', to_jsonb(email_subject(c.content->>'${subject}')))`,
    `('${text}', email_text_spans(d.draft, '${text}', heads, c.content))`,
  ])
  .join(",\n            ");
const salesEventSql = salesEventFields
  .map((field) =>
    field === "salesEvent"
      ? `coalesce((c.content->>'${field}')::boolean, false)`
      : `(c.content->>'${field}')::boolean`,
  )
  .join(" AND ");

export const publishedDraftFields = [
  "title",
  "summary",
  "start",
  "end",
  "deadline",
  "body",
  "cover",
  "public",
  "guests",
  "dietary",
  "food",
  "foodDeadline",
  "questions",
  "tags",
  "reminders",
  "place",
  "maxAttendees",
  "hidePlacesLeft",
  "streamed",
  "streamLink",
  "salesEvent",
  "salesEventType",
  ...publishedOrganizerEmailFields,
  "recurring",
  "repeatEvery",
  "repeatUnit",
] as const;

export const currentDatabaseObjectStatements = [
  `CREATE OR REPLACE FUNCTION zoned_instant(value text) RETURNS timestamptz
      LANGUAGE sql STABLE RETURN regexp_replace(value, '\\[[^]]*\\]$', '')::timestamptz`,
  `CREATE OR REPLACE FUNCTION zoned_zone(value text) RETURNS text
      LANGUAGE sql IMMUTABLE RETURN substring(value from '\\[([^]]*)\\]$')`,
  `CREATE OR REPLACE FUNCTION email_subject(subject text) RETURNS text
      LANGUAGE sql IMMUTABLE AS $$
      SELECT nullif(btrim(regexp_replace(subject, '[[:cntrl:]]+', ' ', 'g')), '')
    $$`,
  `CREATE OR REPLACE FUNCTION email_text_spans(doc automerge, field text, heads text[], content jsonb)
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
  `CREATE OR REPLACE FUNCTION set_publish_times() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      NEW.published_at := now();
      NEW.first_published_at := CASE WHEN TG_OP = 'UPDATE' THEN OLD.first_published_at ELSE now() END;
      RETURN NEW;
    END
    $$`,
  `CREATE OR REPLACE FUNCTION documents_summarize() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      content jsonb := NEW.draft::jsonb;
    BEGIN
      NEW.title := coalesce(content->>'title', '');
      NEW.starts_at := zoned_instant(content->>'start');
      NEW.time_zone := zoned_zone(content->>'start');
      NEW.tags := CASE jsonb_typeof(content->'tags')
        WHEN 'array' THEN ARRAY(
          SELECT tag FROM jsonb_array_elements_text(content->'tags') WITH ORDINALITY AS t (tag, n)
          ORDER BY n)
        ELSE '{}'::text[] END;
      -- Sorted, like published_heads, so the two can be compared.
      NEW.draft_heads := automerge_heads(NEW.draft);
      RETURN NEW;
    END
    $$`,
  `CREATE OR REPLACE FUNCTION events_collect_tags() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO tags (name)
        SELECT DISTINCT ON (lower(tag)) tag FROM unnest(NEW.tags) AS tag
        ON CONFLICT (lower(name)) DO NOTHING;
      RETURN NULL;
    END
    $$`,
  `CREATE OR REPLACE FUNCTION event_visible(event events, member boolean) RETURNS boolean
      LANGUAGE sql STABLE RETURN (event.is_public OR member) AND event.deleted_at IS NULL`,
  `CREATE OR REPLACE FUNCTION events_touch_attendees() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE attendees SET id = id WHERE event_id = NEW.id;
      RETURN NULL;
    END
    $$`,
  `CREATE OR REPLACE FUNCTION teams_touch_events() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE events SET id = id
        WHERE id IN (SELECT id FROM documents WHERE team_id = NEW.id);
      RETURN NULL;
    END
    $$`,
  `CREATE OR REPLACE FUNCTION events_mark_first_published() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE documents SET first_published_at = NEW.first_published_at
        WHERE id = NEW.id AND first_published_at IS NULL;
      RETURN NULL;
    END
    $$`,
  `CREATE OR REPLACE FUNCTION publish_event(document_id uuid, heads text[], issuer text, subject text)
      RETURNS SETOF events LANGUAGE sql AS $$
      INSERT INTO events AS e
        (id, title, summary, starts_at, ends_at, signup_deadline, time_zone, body, cover,
         is_public, allow_guests, ask_dietary, food, food_deadline, questions, tags,
         send_reminders, place, max_attendees, hide_places_left,
         is_streamed, stream_link, sales_event, sales_event_type,
         email_texts, repeat_every, repeat_unit,
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
        -- «Standard» reminds where guests can sign up. Drafts from before
        -- there was a choice: false is "off", true or none "default".
        CASE coalesce(c.content->>'reminders', 'default')
          WHEN 'on' THEN true
          WHEN 'off' THEN false
          WHEN 'false' THEN false
          ELSE (c.content->>'public')::boolean AND (c.content->>'guests')::boolean
        END,
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
        -- A sales event is sent to HubSpot: only a public event open to guests is one.
        ${salesEventSql},
        -- Its type, trimmed; blank is none.
        nullif(regexp_replace(c.content->>'salesEventType', '^\\s+|\\s+$', '', 'g'), ''),
        -- The emails' own subjects and texts; none is left out.
        (SELECT coalesce(jsonb_object_agg(email.key, email.value), '{}')
          FROM (VALUES
            ${publishedOrganizerEmailValues}
          ) AS email(key, value)
          WHERE email.value IS NOT NULL),
        -- Only while recurring; nothing chosen is every 1 week. Through
        -- numeric: a whole number stored as a float reads "2.0".
        CASE WHEN coalesce((c.content->>'recurring')::boolean, false)
          THEN coalesce((c.content->>'repeatEvery')::numeric::integer, ${repeatDefaults.every})
        END,
        CASE WHEN coalesce((c.content->>'recurring')::boolean, false)
          THEN coalesce(c.content->>'repeatUnit', '${repeatDefaults.unit}')
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
        sales_event = EXCLUDED.sales_event,
        sales_event_type = EXCLUDED.sales_event_type,
        email_texts = EXCLUDED.email_texts,
        repeat_every = EXCLUDED.repeat_every,
        repeat_unit = EXCLUDED.repeat_unit,
        published_heads = EXCLUDED.published_heads,
        published_by_issuer = EXCLUDED.published_by_issuer,
        published_by_subject = EXCLUDED.published_by_subject
      RETURNING e.*
    $$`,
  `DROP TRIGGER IF EXISTS documents_notify ON documents`,
  `CREATE TRIGGER documents_notify AFTER INSERT OR UPDATE OR DELETE ON documents
      FOR EACH ROW EXECUTE FUNCTION automerge_notify('${channel}', 'id')`,
  `DROP TRIGGER IF EXISTS documents_summarize ON documents`,
  `CREATE TRIGGER documents_summarize BEFORE INSERT OR UPDATE OF draft ON documents
      FOR EACH ROW EXECUTE FUNCTION documents_summarize()`,
  `DROP TRIGGER IF EXISTS events_publish_times ON events`,
  `CREATE TRIGGER events_publish_times BEFORE INSERT OR UPDATE OF published_heads ON events
      FOR EACH ROW EXECUTE FUNCTION set_publish_times()`,
  `DROP TRIGGER IF EXISTS events_collect_tags ON events`,
  `CREATE TRIGGER events_collect_tags AFTER INSERT OR UPDATE OF tags ON events
      FOR EACH ROW EXECUTE FUNCTION events_collect_tags()`,
  `DROP TRIGGER IF EXISTS events_touch_attendees ON events`,
  `CREATE TRIGGER events_touch_attendees AFTER UPDATE ON events
      FOR EACH ROW WHEN (
        event_visible(OLD, false) IS DISTINCT FROM event_visible(NEW, false)
        OR event_visible(OLD, true) IS DISTINCT FROM event_visible(NEW, true))
      EXECUTE FUNCTION events_touch_attendees()`,
  `DROP TRIGGER IF EXISTS teams_touch_events ON teams`,
  `CREATE TRIGGER teams_touch_events AFTER UPDATE OF name, logo, logo_dark ON teams
      FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name
        OR OLD.logo IS DISTINCT FROM NEW.logo
        OR OLD.logo_dark IS DISTINCT FROM NEW.logo_dark)
      EXECUTE FUNCTION teams_touch_events()`,
  `DROP TRIGGER IF EXISTS events_mark_first_published ON events`,
  `CREATE TRIGGER events_mark_first_published AFTER INSERT ON events
      FOR EACH ROW EXECUTE FUNCTION events_mark_first_published()`,
] as const;

export const installDatabaseObjects = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* Effect.forEach(
    currentDatabaseObjectStatements,
    (statement) => sql.unsafe(statement),
    { discard: true },
  ).pipe(sql.withTransaction);
});
