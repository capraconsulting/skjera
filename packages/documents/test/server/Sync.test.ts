import { assert, layer } from "@effect/vitest";
import { Identity } from "@skjera/oauth/api";
import { Deferred, Effect, Fiber, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { Documents } from "../../src/events/Documents.ts";
import { DocumentId, type TeamId } from "../../src/Model.ts";
import { Announcements } from "../../src/notices/Announcements.ts";
import { Notifications } from "../../src/notices/Notifications.ts";
import type { Pull } from "../../src/server/Sync.ts";
import { Sync } from "../../src/server/Sync.ts";
import { Teams } from "../../src/Teams.ts";
import { TestDatabase } from "../TestDatabase.ts";

const alice = new Identity({ issuer: "https://idp.example", subject: "alice" });

const TestLayer = Layer.mergeAll(Sync.layer, Teams.layer, Documents.layer).pipe(
  Layer.provideMerge(Announcements.layerTest),
  Layer.provideMerge(Notifications.layerTest),
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

const light = "/api/images/AAAAAAAAAAAAAAAAAAAAAA";
const dark = "/api/images/BBBBBBBBBBBBBBBBBBBBBB";

/** A published event, open to anyone, of a team. */
const publishedEvent = (team: TeamId) =>
  Effect.gen(function* () {
    const documents = yield* Documents;
    const sql = yield* SqlClient.SqlClient;
    const id = yield* documents.create("event", team, alice);
    yield* sql`
      INSERT INTO events (id, title, starts_at, ends_at, time_zone, body, is_public,
        allow_guests, ask_dietary, published_heads,
        published_by_issuer, published_by_subject)
      VALUES (${id}, 'Event', '2036-10-15T18:00+02', '2036-10-15T21:00+02', 'Europe/Oslo', '[]', true, false,
        false, '{}', 'test', 'test')
    `;
    return id;
  }).pipe(Effect.orDie);

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

  it.effect("reads one published event by its id, members-only too", () =>
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
      const deleted = yield* publish(true);
      yield* sql`UPDATE events SET deleted_at = now() WHERE id = ${deleted}`;
      const unpublished = yield* publish(false);
      yield* sql`DELETE FROM events WHERE id = ${unpublished}`;
      const draft = yield* documents.create("event", team.id, alice);
      const unknown = Schema.decodeSync(DocumentId)(crypto.randomUUID());

      const read = (id: DocumentId) => sync.event(id);
      assert.isTrue((yield* read(open)).pipe(Option.getOrThrow).isPublic);
      assert.isFalse(
        (yield* read(membersOnly)).pipe(Option.getOrThrow).isPublic,
      );
      for (const id of [deleted, unpublished, draft, unknown]) {
        assert.isTrue(Option.isNone(yield* read(id)));
      }
    }),
  );

  it.effect("pulls an event's place, and events published without one", () =>
    Effect.gen(function* () {
      const sync = yield* Sync;
      const teams = yield* Teams;
      const documents = yield* Documents;
      const sql = yield* SqlClient.SqlClient;
      const team = yield* teams.create(teamName(), alice);
      const publish = (place: string | null) =>
        Effect.gen(function* () {
          const id = yield* documents.create("event", team.id, alice);
          yield* sql`
            INSERT INTO events (id, title, starts_at, ends_at, time_zone, body, is_public,
              allow_guests, ask_dietary, place, published_heads,
              published_by_issuer, published_by_subject)
            VALUES (${id}, 'Event', '2036-10-15T18:00+02', '2036-10-15T21:00+02', 'Europe/Oslo', '[]', true, false,
              false, ${place}, '{}', 'test', 'test')
          `;
          return id;
        });
      const placed = yield* publish("Kantina");
      const before = yield* publish(null);

      const visitor = replica((since) => sync.events(since, "anyone"));
      yield* visitor.pull;
      assert.strictEqual(visitor.rows.get(placed)?.place, "Kantina");
      assert.isTrue(visitor.rows.has(before));
      assert.isNull(visitor.rows.get(before)?.place);

      // A blank place is refused by the table, not kept.
      const blank = yield* Effect.flip(
        sql`UPDATE events SET place = '  ' WHERE id = ${placed}`,
      );
      assert.isDefined(blank);
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
          "tags",
          "teamId",
          "timeZone",
          "title",
          "type",
          "updatedAt",
        ],
      );
      assert.strictEqual(row?.teamId, team.id);

      yield* documents.delete(id, alice);
      const pulled = yield* copy.pull;
      assert.deepStrictEqual(pulled.deleted, [id]);
      assert.isFalse(copy.rows.has(id));
    }),
  );

  it.effect("pulls a team with its logos", () =>
    Effect.gen(function* () {
      const sync = yield* Sync;
      const teams = yield* Teams;
      const bare = yield* teams.create(teamName(), alice);
      const logo = yield* teams.create(teamName(), alice);
      yield* teams.setLogos(logo.id, { logo: light, logoDark: dark });

      const copy = replica(sync.teams);
      yield* copy.pull;
      const logos = (id: TeamId) => {
        const row = copy.rows.get(id);
        return [row?.logo, row?.logoDark];
      };
      assert.deepStrictEqual(logos(bare.id), [null, null]);
      assert.deepStrictEqual(logos(logo.id), [light, dark]);
    }),
  );

  it.effect("pulls each event with its team as its organizer", () =>
    Effect.gen(function* () {
      const sync = yield* Sync;
      const teams = yield* Teams;
      const branded = yield* teams.create(teamName(), alice);
      yield* teams.setLogos(branded.id, { logo: light, logoDark: dark });
      const plain = yield* teams.create(teamName(), alice);
      const withLogos = yield* publishedEvent(branded.id);
      const without = yield* publishedEvent(plain.id);

      const visitor = replica((since) => sync.events(since, "anyone"));
      yield* visitor.pull;
      assert.deepStrictEqual(visitor.rows.get(withLogos)?.organizer, {
        name: branded.name,
        logo: light,
        logoDark: dark,
      });
      assert.deepStrictEqual(visitor.rows.get(without)?.organizer, {
        name: plain.name,
        logo: null,
        logoDark: null,
      });
    }),
  );

  it.effect(
    "pulls a team's events again when its name or a logo changes, and no others",
    () =>
      Effect.gen(function* () {
        const sync = yield* Sync;
        const teams = yield* Teams;
        const team = yield* teams.create(teamName(), alice);
        const neighbour = yield* teams.create(teamName(), alice);
        const first = yield* publishedEvent(team.id);
        const second = yield* publishedEvent(team.id);
        const elsewhere = yield* publishedEvent(neighbour.id);

        const reader = replica((since) => sync.events(since, "anyone"));
        yield* reader.pull;

        const pulledAfter = (change: Effect.Effect<unknown, unknown>) =>
          Effect.gen(function* () {
            yield* Effect.orDie(change);
            return (yield* reader.pull).rows.map((row) => row.id).sort();
          });
        const both = [first, second].sort();

        assert.deepStrictEqual(
          yield* pulledAfter(teams.rename(team.id, `${team.name} renamed`)),
          both,
        );
        assert.strictEqual(
          reader.rows.get(first)?.organizer.name,
          `${team.name} renamed`,
        );
        // A logo alone, then the other alone.
        assert.deepStrictEqual(
          yield* pulledAfter(teams.setLogos(team.id, { logo: light })),
          both,
        );
        assert.strictEqual(reader.rows.get(second)?.organizer.logo, light);
        assert.deepStrictEqual(
          yield* pulledAfter(teams.setLogos(team.id, { logoDark: dark })),
          both,
        );
        assert.strictEqual(reader.rows.get(second)?.organizer.logoDark, dark);
        assert.isNull(reader.rows.get(elsewhere)?.organizer.logo);

        // Nothing changed: nothing to pull.
        assert.deepStrictEqual(
          yield* pulledAfter(teams.setLogos(team.id, { logo: light })),
          [],
        );
      }),
  );

  it.effect("pulls an event published later with its team as it is now", () =>
    Effect.gen(function* () {
      const sync = yield* Sync;
      const teams = yield* Teams;
      const team = yield* teams.create(teamName(), alice);
      yield* teams.rename(team.id, `${team.name} renamed`);
      yield* teams.setLogos(team.id, { logo: light, logoDark: dark });
      const event = yield* publishedEvent(team.id);

      const reader = replica((since) => sync.events(since, "anyone"));
      yield* reader.pull;
      assert.deepStrictEqual(reader.rows.get(event)?.organizer, {
        name: `${team.name} renamed`,
        logo: light,
        logoDark: dark,
      });
    }),
  );
});
