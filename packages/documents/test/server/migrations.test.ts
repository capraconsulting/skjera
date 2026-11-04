import { assert, layer } from "@effect/vitest";
import { Identity } from "@skjera/oauth/api";
import { Effect, Layer } from "effect";
import { Migrator, SqlClient } from "effect/sql";
import { Documents } from "../../src/events/Documents.ts";
import { Announcements } from "../../src/notices/Announcements.ts";
import { Notifications } from "../../src/notices/Notifications.ts";
import { migrations } from "../../src/server/migrations.ts";
import { Teams } from "../../src/Teams.ts";
import { addTags, openEditor } from "../helpers.ts";
import { UnmigratedTestDatabase } from "../TestDatabase.ts";

const alice = new Identity({ issuer: "https://idp.example", subject: "alice" });

// Not migrated: the test runs the migrations itself, in two parts.
const TestLayer = Layer.mergeAll(Teams.layer, Documents.layer).pipe(
  Layer.provideMerge(Announcements.layerTest),
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
              published_by_issuer, published_by_subject)
            VALUES (${id}, 'Meetup', now() + interval '1 day',
              now() + interval '2 days', 'Europe/Oslo', '[]', true, true,
              true, '{}', 'test', 'test')
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
                published_by_issuer, published_by_subject)
              VALUES (${id}, 'Meetup', now() + interval '1 day',
                now() + interval '2 days', 'Europe/Oslo', '[]', true, ${guests},
                false, ${reminders}, '{}', 'test', 'test')
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
layer(TestLayer, { excludeTestServices: true })("Migrations: history", (it) => {
  it.effect(
    "gives an event published before the log its latest publishing as the log's first (AC-6)",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* Migrator.make({})({ loader: upTo(31) });

        const team = yield* (yield* Teams).create("Team", alice);
        const id = yield* (yield* Documents).create("event", team.id, alice);
        yield* sql`
            INSERT INTO events (id, title, starts_at, ends_at, time_zone, body,
              is_public, allow_guests, ask_dietary, published_heads,
              published_by_issuer, published_by_subject)
            VALUES (${id}, 'Meetup', now() + interval '1 day',
              now() + interval '2 days', 'Europe/Oslo', '[]', true, true,
              true, '{abc,def}', 'https://idp.example', 'alice')
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
