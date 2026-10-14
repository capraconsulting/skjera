import { assert, layer } from "@effect/vitest";
import { Identity } from "@skjera/oauth/api";
import { Effect, Layer } from "effect";
import { Migrator, SqlClient } from "effect/sql";
import { Documents } from "../../src/events/Documents.ts";
import { Announcements } from "../../src/notices/Announcements.ts";
import { Notifications } from "../../src/notices/Notifications.ts";
import { migrations } from "../../src/server/migrations.ts";
import { Teams } from "../../src/Teams.ts";
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
