import { existsSync, readFileSync } from "node:fs";
import * as A from "@automerge/automerge";
import { assert, layer } from "@effect/vitest";
import { Identity } from "@skjera/oauth/api";
import { Effect, Layer } from "effect";
import { Migrator, SqlClient } from "effect/sql";
import {
  EventContent,
  repeatDefaults,
  salesEventFields,
} from "../../src/events/ContentTypes.ts";
import { Documents } from "../../src/events/documents/index.ts";
import { Announcements } from "../../src/notices/Announcements.ts";
import { Notifications } from "../../src/notices/Notifications.ts";
import { SalesEvents } from "../../src/notices/SalesEvents.ts";
import { migrations } from "../../src/server/migrations.ts";
import { Teams } from "../../src/Teams.ts";
import { addTags, openEditor } from "../helpers.ts";
import { TestDatabase, UnmigratedTestDatabase } from "../TestDatabase.ts";

const alice = new Identity({ issuer: "https://idp.example", subject: "alice" });

const serverSource = (file: string) => {
  const url = new URL(`../../src/server/${file}`, import.meta.url);
  return existsSync(url) ? readFileSync(url, "utf8") : "";
};

const documentSource = (file: string) =>
  readFileSync(new URL(`../../src/${file}`, import.meta.url), "utf8");

layer(Layer.empty)("Current database objects", (it) => {
  it("keeps publish_event out of numbered migrations (AC-1)", () => {
    assert.notMatch(serverSource("migrations.ts"), /FUNCTION publish_event/);
  });

  it("installs current objects after numbered migrations (AC-2)", () => {
    const source = serverSource("Database.ts");
    assert.match(source, /Migrator\.make[\s\S]+installDatabaseObjects/);
  });

  it("keeps published SQL draft fields in EventContent (AC-3)", () => {
    const source = serverSource("databaseObjects.ts");
    const catalogue = source.match(
      /export const publishedDraftFields = \[([\s\S]*?)\] as const/,
    );
    assert.isDefined(catalogue, "publishedDraftFields is exported");
    const fields = Array.from(
      catalogue?.[1]?.matchAll(/"([A-Za-z]+)"/g) ?? [],
    ).flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
    assert.isNotEmpty(fields);
    assert.deepStrictEqual(
      fields.filter((field) => !(field in EventContent.fields)),
      [],
    );
  });

  it("builds sales and repeat SQL from the shared event rules (AC-1)", () => {
    const source = serverSource("databaseObjects.ts");
    assert.match(source, /salesEventFields\s*\.map/);
    assert.include(source, "repeatDefaults.every");
    assert.include(source, "repeatDefaults.unit");
    assert.deepStrictEqual(salesEventFields, [
      "public",
      "guests",
      "salesEvent",
    ]);
    assert.deepStrictEqual(repeatDefaults, { every: 1, unit: "week" });
  });

  it("routes every event reader through event_visible (AC-1)", () => {
    for (const [file, calls] of [
      ["server/Sync.ts", 2],
      ["site/PublicEvents.ts", 1],
      ["site/Embed.ts", 1],
      ["attendance/Attendance.ts", 1],
    ] as const) {
      assert.lengthOf(
        documentSource(file).match(/event_visible\(/g) ?? [],
        calls,
      );
    }

    const databaseObjects = serverSource("databaseObjects.ts");
    assert.match(
      databaseObjects,
      /event_visible\(OLD, false\)[\s\S]+event_visible\(NEW, false\)/,
    );
    assert.match(
      databaseObjects,
      /event_visible\(OLD, true\)[\s\S]+event_visible\(NEW, true\)/,
    );
  });
});

const VisibilityTestLayer = Layer.mergeAll(Teams.layer, Documents.layer).pipe(
  Layer.provideMerge(Announcements.layerTest),
  Layer.provideMerge(SalesEvents.layerTest),
  Layer.provideMerge(Notifications.layerTest),
  Layer.provideMerge(TestDatabase),
);

layer(VisibilityTestLayer, { excludeTestServices: true })(
  "Event visibility",
  (it) => {
    it.effect("hides deleted events from visitors and members (AC-2)", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const team = yield* (yield* Teams).create("Team", alice);
        const event = (isPublic: boolean, deleted: boolean) =>
          Effect.gen(function* () {
            const id = yield* (yield* Documents).create(
              "event",
              team.id,
              alice,
            );
            yield* sql`
              INSERT INTO events (
                id, title, starts_at, ends_at, time_zone, body, is_public,
                allow_guests, ask_dietary, published_heads,
                published_by_issuer, published_by_subject, deleted_at
              ) VALUES (
                ${id}, 'Event', now() + interval '1 day',
                now() + interval '2 days', 'Europe/Oslo', '[]',
                ${isPublic}, false, false, '{}', 'test', 'test',
                ${deleted ? new Date() : null}
              )
            `;
          });
        yield* Effect.all([
          event(true, false),
          event(false, false),
          event(true, true),
          event(false, true),
        ]);
        const rows = yield* sql<{
          deleted: boolean;
          is_public: boolean;
          member: boolean;
          visible: boolean;
        }>`
          SELECT deleted_at IS NOT NULL AS deleted, is_public, member,
            event_visible(events, member) AS visible
          FROM events
          CROSS JOIN (VALUES (false), (true)) audience(member)
          ORDER BY deleted, is_public, member
        `;

        assert.deepStrictEqual(rows, [
          { deleted: false, is_public: false, member: false, visible: false },
          { deleted: false, is_public: false, member: true, visible: true },
          { deleted: false, is_public: true, member: false, visible: true },
          { deleted: false, is_public: true, member: true, visible: true },
          { deleted: true, is_public: false, member: false, visible: false },
          { deleted: true, is_public: false, member: true, visible: false },
          { deleted: true, is_public: true, member: false, visible: false },
          { deleted: true, is_public: true, member: true, visible: false },
        ]);
      }),
    );
  },
);

// Not migrated: the test runs the migrations itself, in two parts.
const TestLayer = Layer.mergeAll(Teams.layer, Documents.layer).pipe(
  Layer.provideMerge(Announcements.layerTest),
  Layer.provideMerge(SalesEvents.layerTest),
  Layer.provideMerge(Notifications.layerTest),
  Layer.provideMerge(UnmigratedTestDatabase),
);

/** The migrations up to and including `id`. */
const upTo = (id: number) =>
  Effect.map(migrations, (all) => all.filter(([each]) => each <= id));

layer(TestLayer, { excludeTestServices: true })("Migrations", (it) => {
  it.effect(
    "moves the dietary preferences on signups to their events and drops the column",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* Migrator.make({})({ loader: upTo(25) });

        const team = yield* (yield* Teams).create("Team", alice);
        const event = Effect.gen(function* () {
          const id = yield* (yield* Documents).create("event", team.id, alice);
          yield* sql`
            INSERT INTO events (id, title, starts_at, ends_at, time_zone, body,
              is_public, allow_guests, ask_dietary, published_heads,
              published_by_issuer, published_by_subject, first_published_at, published_at)
            VALUES (${id}, 'Meetup', now() + interval '1 day',
              now() + interval '2 days', 'Europe/Oslo', '[]', true, true,
              true, '{}', 'test', 'test', now(), now())
          `;
          return id;
        });
        const signUp = (
          eventId: string,
          name: string,
          dietary: string | null,
        ) => sql`
          INSERT INTO attendees (event_id, name, email, cancel_token_hash, dietary)
          VALUES (${eventId}, ${name}, ${`${name}@example.org`}, ${name}, ${dietary})
        `;

        const first = yield* event;
        const second = yield* event;
        yield* signUp(first, "ada", " Vegan ");
        yield* signUp(first, "bea", "Fish");
        yield* signUp(first, "cat", "");
        yield* signUp(first, "dag", null);
        yield* signUp(second, "eve", "Nuts");

        yield* Migrator.make({})({ loader: migrations });

        const kept = yield* sql<{ event_id: string; text: string }>`
          SELECT event_id, text FROM dietary_preferences ORDER BY text
        `;
        const of = (eventId: string) =>
          kept.filter((row) => row.event_id === eventId).map((row) => row.text);
        assert.deepStrictEqual(of(first), ["Fish", "Vegan"]);
        assert.deepStrictEqual(of(second), ["Nuts"]);
        assert.strictEqual(kept.length, 3);
        const column = yield* sql`
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'attendees' AND column_name = 'dietary'
        `;
        assert.strictEqual(column.length, 0);
      }),
  );
});

layer(TestLayer, { excludeTestServices: true })(
  "Migrations: legacy sync triggers",
  (it) => {
    it.effect(
      "removes a legacy tombstone trigger before dropping its table (AC-2)",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* Migrator.make({})({ loader: upTo(14) });

          yield* sql.unsafe(`CREATE FUNCTION sync_tombstone() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              INSERT INTO sync_deletes (table_name, id) VALUES (TG_TABLE_NAME, OLD.id);
              RETURN OLD;
            END
          $$`);
          yield* sql`CREATE TRIGGER attendees_sync_tombstone AFTER DELETE ON attendees
            FOR EACH ROW EXECUTE FUNCTION sync_tombstone()`;

          const [teamRow] = yield* sql<{ id: string }>`
            INSERT INTO teams (name, created_by_issuer, created_by_subject)
            VALUES ('Team', 'test', 'test') RETURNING id
          `;
          assert.isDefined(teamRow);
          const [documentRow] = yield* sql<{ id: string }>`
            INSERT INTO documents
              (type, team_id, draft, created_by_issuer, created_by_subject)
            VALUES ('event', ${teamRow.id}, ${A.save(A.from({}))}::bytea, 'test', 'test')
            RETURNING id
          `;
          assert.isDefined(documentRow);
          const id = documentRow.id;
          yield* sql`
            INSERT INTO events (id, title, starts_at, ends_at, time_zone, body,
              is_public, allow_guests, ask_dietary, published_heads,
              published_by_issuer, published_by_subject, first_published_at, published_at)
            VALUES (${id}, 'Meetup', now() + interval '1 day',
              now() + interval '2 days', 'Europe/Oslo', '[]', true, true,
              false, '{}', 'test', 'test', now(), now())
          `;
          const [attendeeRow] = yield* sql<{ id: string }>`
            INSERT INTO attendees (event_id, name, email, cancel_token_hash)
            VALUES (${id}, 'Ada', 'ada@example.org', 'token') RETURNING id
          `;
          assert.isDefined(attendeeRow);

          yield* Migrator.make({})({ loader: migrations });
          yield* sql`DELETE FROM attendees WHERE id = ${attendeeRow.id}`;
        }),
    );
  },
);

// A database of its own: the first block above migrates its database whole.
layer(TestLayer, { excludeTestServices: true })(
  "Migrations: reminders",
  (it) => {
    it.effect(
      "turns ticked reminders on a members-only event off and keeps the rest",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* Migrator.make({})({ loader: upTo(28) });

          const team = yield* (yield* Teams).create("Team", alice);
          const event = (reminders: boolean, guests: boolean) =>
            Effect.gen(function* () {
              const id = yield* (yield* Documents).create(
                "event",
                team.id,
                alice,
              );
              yield* sql`
              INSERT INTO events (id, title, starts_at, ends_at, time_zone, body,
                is_public, allow_guests, ask_dietary, send_reminders, published_heads,
                published_by_issuer, published_by_subject, first_published_at, published_at)
              VALUES (${id}, 'Meetup', now() + interval '1 day',
                now() + interval '2 days', 'Europe/Oslo', '[]', true, ${guests},
                false, ${reminders}, '{}', 'test', 'test', now(), now())
            `;
              return id;
            });
          const tickedWithGuests = yield* event(true, true);
          const tickedMembersOnly = yield* event(true, false);
          const unticked = yield* event(false, true);

          yield* Migrator.make({})({ loader: migrations });

          const reminds = (id: string) =>
            sql<{ send_reminders: boolean }>`
            SELECT send_reminders FROM events WHERE id = ${id}
          `.pipe(Effect.map(([row]) => row?.send_reminders));
          assert.strictEqual(yield* reminds(tickedWithGuests), true);
          assert.strictEqual(yield* reminds(tickedMembersOnly), false);
          assert.strictEqual(yield* reminds(unticked), false);
        }),
    );
  },
);

layer(TestLayer, { excludeTestServices: true })(
  "Migrations: legacy publish-time trigger",
  (it) => {
    it.effect(
      "keeps published_at while converting a legacy reminder choice (AC-2)",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* Migrator.make({})({ loader: upTo(17) });
          yield* sql.unsafe(`CREATE FUNCTION set_publish_times() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              NEW.published_at := now();
              NEW.first_published_at := CASE
                WHEN TG_OP = 'UPDATE' THEN OLD.first_published_at ELSE now()
              END;
              RETURN NEW;
            END
          $$`);
          yield* sql`CREATE TRIGGER events_publish_times
            BEFORE INSERT OR UPDATE ON events
            FOR EACH ROW EXECUTE FUNCTION set_publish_times()`;

          const [teamRow] = yield* sql<{ id: string }>`
            INSERT INTO teams (name, created_by_issuer, created_by_subject)
            VALUES ('Team', 'test', 'test') RETURNING id
          `;
          assert.isDefined(teamRow);
          const [documentRow] = yield* sql<{ id: string }>`
            INSERT INTO documents
              (type, team_id, draft, created_by_issuer, created_by_subject)
            VALUES ('event', ${teamRow.id}, ${A.save(A.from({}))}::bytea, 'test', 'test')
            RETURNING id
          `;
          assert.isDefined(documentRow);
          const id = documentRow.id;
          yield* sql`
            INSERT INTO events (id, title, starts_at, ends_at, time_zone, body,
              is_public, allow_guests, ask_dietary, send_reminders,
              published_heads, published_by_issuer, published_by_subject,
              first_published_at, published_at)
            VALUES (${id}, 'Meetup', now() + interval '1 day',
              now() + interval '2 days', 'Europe/Oslo', '[]', true, false,
              false, true, '{}', 'test', 'test', now(), now())
          `;
          const [before] = yield* sql<{ published_at: Date }>`
            SELECT published_at FROM events WHERE id = ${id}
          `;

          yield* Effect.sleep("10 millis");
          yield* Migrator.make({})({ loader: migrations });

          const [after] = yield* sql<{ published_at: Date }>`
            SELECT published_at FROM events WHERE id = ${id}
          `;
          const [history] = yield* sql<{ published_at: Date }>`
            SELECT published_at FROM event_publications WHERE event_id = ${id}
          `;
          assert.deepStrictEqual(after?.published_at, before?.published_at);
          assert.deepStrictEqual(history?.published_at, before?.published_at);
        }),
    );
  },
);

// A database of its own: each block above migrates its database whole.
layer(TestLayer, { excludeTestServices: true })(
  "Migrations: document tags",
  (it) => {
    it.effect(
      "gives a draft made before the tags column its tags, and leaves when it was edited as it was (AC-1, AC-7)",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* Migrator.make({})({ loader: upTo(30) });

          const documents = yield* Documents;
          const team = yield* (yield* Teams).create("Team", alice);
          const tagged = yield* documents.create("event", team.id, alice);
          const editor = yield* openEditor(tagged);
          yield* documents.applyChanges(
            tagged,
            [editor.edit((event) => addTags(event, "Sosialt", "Fag"))],
            alice,
          );
          const untagged = yield* documents.create("event", team.id, alice);
          const editedAt = (id: string) =>
            sql<{ updated_at: Date }>`
              SELECT updated_at FROM documents WHERE id = ${id}
            `.pipe(Effect.map(([row]) => row?.updated_at));
          const before = yield* editedAt(tagged);

          yield* Migrator.make({})({ loader: migrations });

          const tagsOf = (id: string) =>
            sql<{ tags: ReadonlyArray<string> }>`
              SELECT tags FROM documents WHERE id = ${id}
            `.pipe(Effect.map(([row]) => row?.tags));
          assert.deepStrictEqual(yield* tagsOf(tagged), ["Sosialt", "Fag"]);
          assert.deepStrictEqual(yield* tagsOf(untagged), []);
          assert.deepStrictEqual(yield* editedAt(tagged), before);
        }),
    );
  },
);

// A database of its own: each block above migrates its database whole.
layer(TestLayer, { excludeTestServices: true })(
  "Migrations: first publish",
  (it) => {
    it.effect(
      "marks the events published before the column as published, unpublished ones too, and leaves the rest (AC-4)",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* Migrator.make({})({ loader: upTo(31) });

          const team = yield* (yield* Teams).create("Team", alice);
          const document = Effect.gen(function* () {
            return yield* (yield* Documents).create("event", team.id, alice);
          });
          const publish = (id: string) => sql`
            INSERT INTO events (id, title, starts_at, ends_at, time_zone, body,
              is_public, allow_guests, ask_dietary, published_heads,
              published_by_issuer, published_by_subject, first_published_at, published_at)
            VALUES (${id}, 'Meetup', now() + interval '1 day',
              now() + interval '2 days', 'Europe/Oslo', '[]', true, true,
              true, '{}', 'test', 'test', now(), now())
          `;
          const published = yield* document;
          const unpublished = yield* document;
          const never = yield* document;
          yield* publish(published);
          yield* publish(unpublished);
          yield* sql`UPDATE events SET deleted_at = now() WHERE id = ${unpublished}`;

          yield* Migrator.make({})({ loader: migrations });

          const firstPublished = (id: string) =>
            sql<{ first_published_at: Date | null }>`
              SELECT first_published_at FROM documents WHERE id = ${id}
            `.pipe(Effect.map(([row]) => row?.first_published_at));
          assert.instanceOf(yield* firstPublished(published), Date);
          assert.instanceOf(yield* firstPublished(unpublished), Date);
          assert.isNull(yield* firstPublished(never));
        }),
    );
  },
);

// A database of its own: each block above migrates its database whole.
layer(TestLayer, { excludeTestServices: true })("Migrations: history", (it) => {
  it.effect(
    "gives an event published before the log its latest publishing as the log's first (AC-6)",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* Migrator.make({})({ loader: upTo(32) });

        const team = yield* (yield* Teams).create("Team", alice);
        const id = yield* (yield* Documents).create("event", team.id, alice);
        yield* sql`
            INSERT INTO events (id, title, starts_at, ends_at, time_zone, body,
              is_public, allow_guests, ask_dietary, published_heads,
              published_by_issuer, published_by_subject, first_published_at, published_at)
            VALUES (${id}, 'Meetup', now() + interval '1 day',
              now() + interval '2 days', 'Europe/Oslo', '[]', true, true,
              true, '{abc,def}', 'https://idp.example', 'alice', now(), now())
          `;
        const [before] = yield* sql<{ published_at: Date }>`
            SELECT published_at FROM events WHERE id = ${id}
          `;

        yield* Migrator.make({})({ loader: migrations });

        const log = yield* sql<{
          heads: ReadonlyArray<string>;
          published_at: Date;
          published_by_issuer: string | null;
          published_by_subject: string | null;
        }>`
            SELECT heads, published_at, published_by_issuer, published_by_subject
            FROM event_publications WHERE event_id = ${id}
          `;
        assert.lengthOf(log, 1);
        assert.deepStrictEqual(log[0]?.heads, ["abc", "def"]);
        assert.deepStrictEqual(log[0]?.published_at, before?.published_at);
        assert.strictEqual(log[0]?.published_by_issuer, "https://idp.example");
        assert.strictEqual(log[0]?.published_by_subject, "alice");
      }),
  );
});
