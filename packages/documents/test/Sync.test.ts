import { assert, layer } from "@effect/vitest";
import { Identity } from "@skjera/oauth/api";
import { Deferred, Effect, Fiber, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { Documents } from "../src/Documents.ts";
import type { Pull } from "../src/Sync.ts";
import { Sync } from "../src/Sync.ts";
import { Teams } from "../src/Teams.ts";
import { TestDatabase } from "./TestDatabase.ts";

const alice = new Identity({ issuer: "https://idp.example", subject: "alice" });

const TestLayer = Layer.mergeAll(Sync.layer, Teams.layer, Documents.layer).pipe(
  Layer.provideMerge(TestDatabase),
);

/** A client's copy of a table, kept by pulling. */
const replica = <Row extends { readonly id: string }>(
  pull: (since: string | undefined) => Effect.Effect<Pull<Row>>,
) => {
  const rows = new Map<string, Row>();
  let since: string | undefined;
  return {
    rows,
    pull: Effect.gen(function* () {
      const pulled = yield* pull(since);
      if (pulled.complete) rows.clear();
      for (const row of pulled.rows) rows.set(row.id, row);
      for (const id of pulled.deleted) rows.delete(id);
      since = pulled.token;
      return pulled;
    }),
  };
};

let teamCount = 0;
const teamName = () => `Team ${++teamCount}`;

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Sync", (it) => {
  it.effect("pulls everything, then only what changed", () =>
    Effect.gen(function* () {
      const sync = yield* Sync;
      const teams = yield* Teams;
      const kept = yield* teams.create(teamName(), alice);
      const renamed = yield* teams.create(teamName(), alice);
      const deleted = yield* teams.create(teamName(), alice);

      const copy = replica(sync.teams);
      const first = yield* copy.pull;
      assert.isTrue(first.complete);
      for (const team of [kept, renamed, deleted]) {
        assert.isTrue(copy.rows.has(team.id));
      }

      // Nothing changed: nothing to pull.
      const idle = yield* copy.pull;
      assert.isFalse(idle.complete);
      assert.deepStrictEqual([idle.rows.length, idle.deleted.length], [0, 0]);

      yield* teams.rename(renamed.id, "Renamed");
      yield* teams.delete(deleted.id);
      const added = yield* teams.create(teamName(), alice);
      const next = yield* copy.pull;
      assert.deepStrictEqual(
        next.rows.map((row) => row.id).sort(),
        [renamed.id, added.id].sort(),
      );
      assert.deepStrictEqual(next.deleted, [deleted.id]);
      assert.strictEqual(copy.rows.get(renamed.id)?.name, "Renamed");
      assert.isFalse(copy.rows.has(deleted.id));
      assert.isTrue(copy.rows.has(added.id));
    }),
  );

  it.effect("sees writes that commit after a later one was pulled", () =>
    Effect.gen(function* () {
      const sync = yield* Sync;
      const teams = yield* Teams;
      const sql = yield* SqlClient.SqlClient;
      const copy = replica(sync.teams);
      yield* copy.pull;

      // A slow transaction writes first but commits last.
      const written = yield* Deferred.make<void>();
      const commit = yield* Deferred.make<void>();
      const slowName = teamName();
      const slow = yield* Effect.gen(function* () {
        yield* sql`
          INSERT INTO teams (name, created_by_issuer, created_by_subject)
          VALUES (${slowName}, 'test', 'test')
        `;
        yield* Deferred.succeed(written, undefined);
        yield* Deferred.await(commit);
      }).pipe(sql.withTransaction, Effect.forkChild);
      yield* Deferred.await(written);

      // A quick one commits in between, and gets pulled.
      const quick = yield* teams.create(teamName(), alice);
      yield* copy.pull;
      assert.isTrue(copy.rows.has(quick.id));

      // Once the slow one commits, the next pull has it.
      yield* Deferred.succeed(commit, undefined);
      yield* Fiber.join(slow);
      yield* copy.pull;
      assert.isTrue(
        [...copy.rows.values()].some((row) => row.name === slowName),
      );
    }).pipe(Effect.timeout("10 seconds")),
  );

  it.effect("shows events by audience, and removes those hidden since", () =>
    Effect.gen(function* () {
      const sync = yield* Sync;
      const teams = yield* Teams;
      const documents = yield* Documents;
      const sql = yield* SqlClient.SqlClient;
      const team = yield* teams.create(teamName(), alice);
      const publish = (isPublic: boolean) =>
        Effect.gen(function* () {
          const id = yield* documents.create("event", team.id, alice);
          yield* sql`
            INSERT INTO events (id, title, starts_at, ends_at, time_zone, body, is_public,
              allow_guests, ask_dietary, published_heads,
              published_by_issuer, published_by_subject)
            VALUES (${id}, 'Event', '2036-10-15T18:00+02', '2036-10-15T21:00+02', 'Europe/Oslo', '[]', ${isPublic}, false,
              false, '{}', 'test', 'test')
          `;
          return id;
        });
      const open = yield* publish(true);
      const membersOnly = yield* publish(false);

      const visitor = replica((since) => sync.events(since, "anyone"));
      const member = replica((since) => sync.events(since, "members"));
      yield* visitor.pull;
      yield* member.pull;
      assert.isTrue(visitor.rows.has(open));
      assert.isFalse(visitor.rows.has(membersOnly));
      assert.isTrue(member.rows.has(membersOnly));

      // Made members-only: it leaves the visitor's copy, not the member's.
      yield* sql`UPDATE events SET is_public = false WHERE id = ${open}`;
      const pulled = yield* visitor.pull;
      assert.deepStrictEqual(pulled.deleted, [open]);
      assert.isFalse(visitor.rows.has(open));
      yield* member.pull;
      assert.isFalse(member.rows.get(open)?.isPublic);

      // And back.
      yield* sql`UPDATE events SET is_public = true WHERE id = ${open}`;
      yield* visitor.pull;
      assert.isTrue(visitor.rows.get(open)?.isPublic);
    }),
  );

  it.effect("hides attendees with their event, and who they are", () =>
    Effect.gen(function* () {
      const sync = yield* Sync;
      const teams = yield* Teams;
      const documents = yield* Documents;
      const sql = yield* SqlClient.SqlClient;
      const team = yield* teams.create(teamName(), alice);
      const event = yield* documents.create("event", team.id, alice);
      yield* sql`
        INSERT INTO events (id, title, starts_at, ends_at, time_zone, body, is_public,
          allow_guests, ask_dietary, published_heads,
          published_by_issuer, published_by_subject)
        VALUES (${event}, 'Event', '2036-10-15T18:00+02', '2036-10-15T21:00+02', 'Europe/Oslo', '[]', true, false, false,
          '{}', 'test', 'test')
      `;
      const [signup] = yield* sql<{ id: string }>`
        INSERT INTO attendees (event_id, user_issuer, user_subject, name, email)
        VALUES (${event}, ${alice.issuer}, ${alice.subject}, 'Alice', 'a@example.org')
        RETURNING id
      `;
      const id = signup?.id ?? "";

      const visitor = replica((since) => sync.attendees(since, Option.none()));
      const member = replica((since) =>
        sync.attendees(since, Option.some(alice)),
      );
      yield* visitor.pull;
      yield* member.pull;
      // Anyone can count them; only members see who, and whose it is.
      assert.isNull(visitor.rows.get(id)?.details);
      assert.isFalse(visitor.rows.get(id)?.mine);
      assert.strictEqual(member.rows.get(id)?.details?.name, "Alice");
      assert.isTrue(member.rows.get(id)?.mine);

      // The event goes members-only: its attendees leave the visitor's
      // copy, though they didn't change themselves.
      yield* sql`UPDATE events SET is_public = false WHERE id = ${event}`;
      const pulled = yield* visitor.pull;
      assert.deepStrictEqual(pulled.deleted, [id]);
      yield* member.pull;
      assert.isTrue(member.rows.has(id));

      // Public again: back for the visitor.
      yield* sql`UPDATE events SET is_public = true WHERE id = ${event}`;
      yield* visitor.pull;
      assert.isTrue(visitor.rows.has(id));
    }),
  );

  it.effect("syncs documents without their draft", () =>
    Effect.gen(function* () {
      const sync = yield* Sync;
      const teams = yield* Teams;
      const documents = yield* Documents;
      const team = yield* teams.create(teamName(), alice);
      const copy = replica(sync.documents);
      yield* copy.pull;

      const id = yield* documents.create("event", team.id, alice);
      yield* copy.pull;
      const row = copy.rows.get(id);
      assert.deepStrictEqual(
        row === undefined ? undefined : Object.keys(row).sort(),
        [
          "createdAt",
          "draftHeads",
          "id",
          "startsAt",
          "teamId",
          "timeZone",
          "title",
          "type",
          "updatedAt",
        ],
      );
      assert.strictEqual(row?.teamId, team.id);

      yield* documents.delete(id);
      const pulled = yield* copy.pull;
      assert.deepStrictEqual(pulled.deleted, [id]);
      assert.isFalse(copy.rows.has(id));
    }),
  );
});
