import * as A from "@automerge/automerge";
import { NodeCrypto } from "@effect/platform-node";
import { assert, describe, it, layer } from "@effect/vitest";
import { Email } from "@skjera/email";
import * as EmailTest from "@skjera/email/testing";
import { Identity } from "@skjera/oauth/api";
import { Cron, Effect, Layer, Schedule } from "effect";
import { SingleRunner } from "effect/cluster";
import { SqlClient } from "effect/sql";
import { Attendance } from "../../src/attendance/Attendance.ts";
import * as SignupRetention from "../../src/attendance/SignupRetention.ts";
import type { EventContent } from "../../src/events/ContentTypes.ts";
import { Documents } from "../../src/events/Documents.ts";
import type { DocumentId, TeamId } from "../../src/Model.ts";
import { Announcements } from "../../src/notices/Announcements.ts";
import * as Mail from "../../src/notices/Mail.tsx";
import { Teams } from "../../src/Teams.ts";
import { TestDatabase } from "../TestDatabase.ts";

// When sign-up data is deleted: the schedule, and what the nightly job
// deletes and keeps, on a cluster with the real event mailer on the test
// database. Tests that put events in by hand pick a `now` of their own, years
// apart; those that sign a guest up through `Attendance` need an event that
// starts after the real time, so their `now` sits near it. Each test counts
// only its own events, right after its own run.

const day = 24 * 60 * 60 * 1000;
const hour = 60 * 60 * 1000;

describe("The schedule", () => {
  it("runs at 01:00 UTC whatever zone the process is in", () => {
    const before = process.env.TZ;
    process.env.TZ = "Europe/Oslo";
    try {
      assert.strictEqual(
        Cron.next(
          SignupRetention.schedule,
          new Date("2026-03-29T00:30:00Z"),
        ).toISOString(),
        "2026-03-29T01:00:00.000Z",
      );
      assert.strictEqual(
        Cron.next(
          SignupRetention.schedule,
          new Date("2026-03-29T01:00:01Z"),
        ).toISOString(),
        "2026-03-30T01:00:00.000Z",
      );
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });
});

const outbox = EmailTest.make();

const cluster = SingleRunner.layer({
  shardingConfig: {
    entityMessagePollInterval: "50 millis",
    entityReplyPollInterval: "50 millis",
  },
}).pipe(Layer.provide(NodeCrypto.layer));

const TestLayer = Layer.mergeAll(
  Documents.layer,
  Teams.layer,
  Mail.layerMailer,
).pipe(
  Layer.provideMerge(Attendance.layer),
  Layer.provideMerge(Announcements.layerTest),
  Layer.provideMerge(Mail.layerNotifications),
  Layer.provideMerge(Layer.succeed(Email, outbox.email)),
  Layer.provideMerge(cluster),
  Layer.provideMerge(TestDatabase),
);

const alice = new Identity({
  issuer: "https://idp.example",
  subject: "alice",
  email: "alice@example.com",
  name: "Alice",
});

let teams = 0;

/**
 * An event as published, put in the table by hand: it ends at `endsAt`
 * (three hours after `startsAt` when that is given instead), in a team of
 * its own, open to guests.
 */
const insertEvent = (
  options: {
    readonly startsAt?: Date;
    readonly endsAt?: Date;
    readonly deleted?: boolean;
  } = {},
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const team = yield* (yield* Teams).create(`Retention ${++teams}`, alice);
    const id = yield* (yield* Documents).create("event", team.id, alice);
    const endsAt =
      options.endsAt ??
      new Date((options.startsAt ?? new Date()).getTime() + 3 * hour);
    const startsAt = options.startsAt ?? new Date(endsAt.getTime() - 3 * hour);
    yield* sql`
      INSERT INTO events (id, title, starts_at, ends_at, time_zone, body, is_public,
        allow_guests, ask_dietary, send_reminders, place, summary, published_heads,
        published_by_issuer, published_by_subject, deleted_at)
      VALUES (${id}, 'Launch', ${startsAt}, ${endsAt}, 'Europe/Oslo', '[]', true,
        true, false, false, 'Kantina', 'An evening', '{}', 'test', 'test',
        ${options.deleted === true ? new Date() : null})
    `;
    return id as DocumentId;
  }).pipe(Effect.orDie);

/** A member's and a guest's signup, with every column set. */
const addSignups = (event: DocumentId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const answers = JSON.stringify([
      { question: "Bringing a plus one?", answer: "Yes" },
    ]);
    yield* sql`
      INSERT INTO attendees (event_id, user_issuer, user_subject, name, email, answers,
        locale, online)
      VALUES (${event}, 'https://idp.example', ${`member-${crypto.randomUUID()}`},
        'Mia Member', 'mia@example.com', ${answers}::jsonb, 'nb', true)
    `;
    yield* sql`
      INSERT INTO attendees (event_id, name, email, phone, company, answers,
        cancel_token_hash, locale, online)
      VALUES (${event}, 'Gina Guest', ${`gina-${crypto.randomUUID()}@example.org`},
        '+47 123 45 678', 'Example Ltd', ${answers}::jsonb,
        ${`hash-${crypto.randomUUID()}`}, 'en', false)
    `;
  }).pipe(Effect.orDie);

const addDietary = (event: DocumentId, texts: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    for (const text of texts) {
      yield* sql`INSERT INTO dietary_preferences (event_id, text) VALUES (${event}, ${text})`;
    }
  }).pipe(Effect.orDie);

const signupsOf = (event: DocumentId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ n: number }>`
      SELECT count(*)::int AS n FROM attendees WHERE event_id = ${event}
    `;
    return row?.n ?? 0;
  }).pipe(Effect.orDie);

const dietaryOf = (event: DocumentId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ n: number }>`
      SELECT count(*)::int AS n FROM dietary_preferences WHERE event_id = ${event}
    `;
    return row?.n ?? 0;
  }).pipe(Effect.orDie);

const addInvitations = (event: DocumentId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO invitations (event_id, name, email)
      VALUES (${event}, 'Gina Guest', ${`gina-${crypto.randomUUID()}@example.org`}),
        (${event}, NULL, ${`hana-${crypto.randomUUID()}@example.org`})
    `;
  }).pipe(Effect.orDie);

const invitationsOf = (event: DocumentId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ n: number }>`
      SELECT count(*)::int AS n FROM invitations WHERE event_id = ${event}
    `;
    return row?.n ?? 0;
  }).pipe(Effect.orDie);

/** An event never published, with invitations: its draft starts at 18:00 and ends at `end`, if given. */
const draftWithInvitations = (end?: string) =>
  Effect.gen(function* () {
    const documents = yield* Documents;
    const id = yield* documents.create(
      "event",
      (yield* (yield* Teams).create(`Retention ${++teams}`, alice)).id,
      alice,
    );
    if (end !== undefined) {
      const snapshot = yield* documents.get(id);
      const doc = A.change(A.load<EventContent>(snapshot.draft), (event) => {
        const draft = event as Record<string, unknown>;
        draft.start = new A.ImmutableString(
          `${end.slice(0, 10)}T18:00+02:00[Europe/Oslo]`,
        );
        draft.end = new A.ImmutableString(end);
      });
      const change = A.getLastLocalChange(doc);
      if (change === undefined) throw new Error("no change");
      yield* documents.applyChanges(id, [change], alice);
    }
    yield* addInvitations(id as DocumentId);
    return id as DocumentId;
  }).pipe(Effect.orDie);

/** An event with a signup and a dietary preference, ending at `endsAt`. */
const withSignup = (endsAt: Date, deleted = false) =>
  Effect.gen(function* () {
    const event = yield* insertEvent({ endsAt, deleted });
    yield* addSignups(event);
    yield* addDietary(event, ["Vegan"]);
    return event;
  });

/** The mailer's stored messages for an event, whatever the case of its id. */
const storedFor = (event: DocumentId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql<{
      readonly id: string;
      readonly entity_id: string;
      readonly processed: boolean;
    }>`
      SELECT id, entity_id, processed FROM cluster_messages
      WHERE entity_type = 'EventMail' AND lower(entity_id) = ${event}
    `;
  }).pipe(Effect.orDie);

/** How many replies there are to the messages with these ids. */
const repliesTo = (ids: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ n: number }>`
      SELECT count(*)::int AS n FROM cluster_replies
      WHERE request_id = ANY(${ids}::bigint[])
    `;
    return row?.n ?? 0;
  }).pipe(Effect.orDie);

/** The event's stored messages, once there are some and the mailer has handled all. */
const handledFor = (event: DocumentId) =>
  storedFor(event).pipe(
    Effect.filterOrFail(
      (rows) => rows.length > 0 && rows.every((row) => row.processed),
      () => "not yet",
    ),
    Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 100 }),
    Effect.orDie,
  );

/** An event open to sign-up for guests, starting a month from the real time. */
const comingEvent = insertEvent({
  startsAt: new Date(Date.now() + 30 * day),
});

/** Signs a guest up to `event` (written as given), waiting for the mailer to handle it. */
const signGuestUp = (event: DocumentId) =>
  Effect.gen(function* () {
    const address = `gina-${crypto.randomUUID()}@example.org`;
    yield* (yield* Attendance).attendAsGuest(event, {
      name: "Gina Guest",
      email: address,
    });
    return yield* handledFor(event.toLowerCase() as DocumentId);
  });

const endOf = (event: DocumentId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ ends_at: Date }>`
      SELECT ends_at FROM events WHERE id = ${event.toLowerCase()}
    `;
    return row?.ends_at ?? new Date(0);
  }).pipe(Effect.orDie);

/** Sets times the way the editor does: values replaced as a whole. */
const setTimes = (event: EventContent) => {
  const draft = event as Record<string, unknown>;
  draft.start = new A.ImmutableString("2036-10-15T18:00+02:00[Europe/Oslo]");
  draft.end = new A.ImmutableString("2036-10-15T21:00+02:00[Europe/Oslo]");
};

/** Creates and publishes an event from a draft, the way the studio does. */
const publishFromDraft = (title: string) =>
  Effect.gen(function* () {
    const documents = yield* Documents;
    const id = yield* documents.create(
      "event",
      (yield* (yield* Teams).create(`Retention ${++teams}`, alice)).id,
      alice,
    );
    const snapshot = yield* documents.get(id);
    let doc = A.load<EventContent>(snapshot.draft);
    doc = A.change(doc, (event) => {
      A.updateText(event, ["title"], title);
      setTimes(event);
      A.updateText(event, ["place"], "Kantina");
      (event as { public: boolean }).public = true;
      (event as { guests: boolean }).guests = true;
    });
    const change = A.getLastLocalChange(doc);
    if (change === undefined) throw new Error("no change");
    const heads = yield* documents.applyChanges(id, [change], alice);
    yield* documents.publish(id, heads, alice);
    return id as DocumentId;
  }).pipe(Effect.orDie);

/** What the job must leave of an event: its published row, its draft's heads, its actors. */
const kept = (event: DocumentId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [published] = yield* sql`
      SELECT title, starts_at, ends_at, body, published_heads, deleted_at
      FROM events WHERE id = ${event}
    `;
    const [document] = yield* sql`
      SELECT automerge_heads(draft) AS heads FROM documents WHERE id = ${event}
    `;
    const [actors] = yield* sql<{ n: number }>`
      SELECT count(*)::int AS n FROM document_actors WHERE document_id = ${event}
    `;
    return { published, document, actors: actors?.n };
  }).pipe(Effect.orDie);

// Real clock: these tests talk to a real database and a real cluster.
layer(TestLayer, { excludeTestServices: true })("Signup retention", (it) => {
  it.effect("deletes the signups of events ended long ago", () =>
    Effect.gen(function* () {
      const now = new Date("2041-06-01T01:00:00Z");
      const old = yield* withSignup(new Date(now.getTime() - 365 * day));
      const recent = yield* withSignup(new Date(now.getTime() - 31 * day));
      assert.strictEqual(yield* signupsOf(old), 2);

      yield* SignupRetention.deleteSignups(now);

      assert.strictEqual(yield* signupsOf(old), 0);
      assert.strictEqual(yield* signupsOf(recent), 0);
    }),
  );

  it.effect(
    "deletes members' and guests' signups after 30 days and a second",
    () =>
      Effect.gen(function* () {
        const now = new Date("2042-06-01T01:00:00Z");
        const event = yield* withSignup(
          new Date(now.getTime() - 30 * day - 1000),
        );
        assert.strictEqual(yield* signupsOf(event), 2);

        yield* SignupRetention.deleteSignups(now);

        assert.strictEqual(yield* signupsOf(event), 0);
      }),
  );

  it.effect(
    "forgets the emails kept for a guest, and the replies to them",
    () =>
      Effect.gen(function* () {
        const event = yield* comingEvent;
        const stored = yield* signGuestUp(event);
        assert.isAbove(yield* repliesTo(stored.map((row) => row.id)), 0);
        const ended = yield* endOf(event);

        yield* SignupRetention.deleteSignups(
          new Date(ended.getTime() + 31 * day),
        );

        assert.lengthOf(yield* storedFor(event), 0);
        assert.strictEqual(yield* repliesTo(stored.map((row) => row.id)), 0);
      }),
  );

  it.effect(
    "tells the emails kept under an id in capitals from the event's",
    () =>
      Effect.gen(function* () {
        const event = yield* comingEvent;
        const upper = event.toUpperCase() as DocumentId;
        yield* signGuestUp(upper);
        const stored = yield* storedFor(event);
        assert.isTrue(stored.some((row) => row.entity_id === upper));
        const ended = yield* endOf(event);

        // Kept while the event has not ended, however its id is written.
        yield* SignupRetention.deleteSignups(new Date());
        assert.lengthOf(yield* storedFor(event), stored.length);

        yield* SignupRetention.deleteSignups(
          new Date(ended.getTime() + 31 * day),
        );
        assert.lengthOf(yield* storedFor(event), 0);
      }),
  );

  it.effect("forgets the emails of an event gone with its team", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const event = yield* comingEvent;
      yield* signGuestUp(event);
      const [row] = yield* sql<{ team_id: TeamId }>`
        SELECT team_id FROM documents WHERE id = ${event}
      `.pipe(Effect.orDie);
      yield* (yield* Documents).delete(event, alice);
      // The cancelled email is a message of its own: wait until it is handled too.
      yield* storedFor(event).pipe(
        Effect.filterOrFail(
          (rows) =>
            rows.length >= 2 && rows.every((stored) => stored.processed),
          () => "not yet",
        ),
        Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 100 }),
        Effect.orDie,
      );
      yield* (yield* Teams).delete(row?.team_id as TeamId).pipe(Effect.orDie);
      assert.isAbove((yield* storedFor(event)).length, 0);

      yield* SignupRetention.deleteSignups(new Date());

      assert.lengthOf(yield* storedFor(event), 0);
    }),
  );

  it.effect("deletes an event's dietary list", () =>
    Effect.gen(function* () {
      const now = new Date("2043-06-01T01:00:00Z");
      const event = yield* insertEvent({
        endsAt: new Date(now.getTime() - 31 * day),
      });
      yield* addDietary(event, ["Vegan", "No nuts"]);
      assert.lengthOf(yield* (yield* Attendance).dietaryPreferences(event), 2);

      yield* SignupRetention.deleteSignups(now);

      assert.strictEqual(yield* dietaryOf(event), 0);
      assert.lengthOf(yield* (yield* Attendance).dietaryPreferences(event), 0);
    }),
  );

  it.effect("deletes the sign-up data of a deleted event too", () =>
    Effect.gen(function* () {
      const now = new Date("2044-06-01T01:00:00Z");
      const event = yield* withSignup(new Date(now.getTime() - 31 * day), true);

      yield* SignupRetention.deleteSignups(now);

      assert.strictEqual(yield* signupsOf(event), 0);
      assert.strictEqual(yield* dietaryOf(event), 0);
    }),
  );

  it.effect("keeps the sign-up data of a deleted event for 30 days", () =>
    Effect.gen(function* () {
      const now = new Date("2045-06-01T01:00:00Z");
      const event = yield* withSignup(new Date(now.getTime() - 10 * day), true);

      yield* SignupRetention.deleteSignups(now);

      assert.strictEqual(yield* signupsOf(event), 2);
      assert.strictEqual(yield* dietaryOf(event), 1);
    }),
  );

  it.effect(
    "keeps the data of events that ended 30 days ago or less, or have not ended",
    () =>
      Effect.gen(function* () {
        const now = new Date("2046-06-01T01:00:00Z");
        const events = [
          yield* withSignup(new Date(now.getTime() - 30 * day)),
          yield* withSignup(new Date(now.getTime() - 29 * day)),
          yield* withSignup(new Date(now.getTime() + 2 * hour)),
          yield* withSignup(new Date(now.getTime() + day + 3 * hour)),
        ];

        yield* SignupRetention.deleteSignups(now);

        for (const event of events) {
          assert.strictEqual(yield* signupsOf(event), 2);
          assert.strictEqual(yield* dietaryOf(event), 1);
        }
      }),
  );

  it.effect(
    "keeps the emails of an event that has not ended, or ended 30 days ago",
    () =>
      Effect.gen(function* () {
        const event = yield* comingEvent;
        const stored = yield* signGuestUp(event);
        const ended = yield* endOf(event);

        yield* SignupRetention.deleteSignups(new Date());
        assert.lengthOf(yield* storedFor(event), stored.length);

        yield* SignupRetention.deleteSignups(
          new Date(ended.getTime() + 30 * day),
        );
        assert.lengthOf(yield* storedFor(event), stored.length);
      }),
  );

  it.effect("leaves the event, its draft and its actors as they were", () =>
    Effect.gen(function* () {
      const event = yield* publishFromDraft(`Retention ${crypto.randomUUID()}`);
      yield* addSignups(event);
      yield* addDietary(event, ["Vegan"]);
      const before = yield* kept(event);
      assert.isDefined(before.published);

      yield* SignupRetention.deleteSignups(new Date("2036-11-15T01:00:00Z"));

      assert.strictEqual(yield* signupsOf(event), 0);
      assert.deepStrictEqual(yield* kept(event), before);
    }),
  );

  it.effect(
    "deletes an event's invitations 30 days and a second after it ends, deleted events too (AC-7)",
    () =>
      Effect.gen(function* () {
        const now = new Date("2047-06-01T01:00:00Z");
        const ended = new Date(now.getTime() - 30 * day - 1000);
        const events = [
          yield* insertEvent({ endsAt: ended }),
          yield* insertEvent({ endsAt: ended, deleted: true }),
        ];
        for (const event of events) {
          yield* addInvitations(event);
          assert.strictEqual(yield* invitationsOf(event), 2);
        }

        yield* SignupRetention.deleteSignups(now);

        for (const event of events) {
          assert.strictEqual(yield* invitationsOf(event), 0);
        }
      }),
  );

  it.effect(
    "keeps the invitations of events that ended 30 days ago or less, or have not ended (AC-7)",
    () =>
      Effect.gen(function* () {
        const now = new Date("2048-06-01T01:00:00Z");
        const events = [
          yield* insertEvent({ endsAt: new Date(now.getTime() - 30 * day) }),
          yield* insertEvent({ endsAt: new Date(now.getTime() - 29 * day) }),
          yield* insertEvent({ endsAt: new Date(now.getTime() + 2 * hour) }),
          yield* insertEvent({
            endsAt: new Date(now.getTime() - 10 * day),
            deleted: true,
          }),
        ];
        for (const event of events) yield* addInvitations(event);

        yield* SignupRetention.deleteSignups(now);

        for (const event of events) {
          assert.strictEqual(yield* invitationsOf(event), 2);
        }
      }),
  );

  it.effect(
    "deletes the invitations of an event never published 30 days after its draft's end, and keeps a draft with no end (AC-7)",
    () =>
      Effect.gen(function* () {
        const now = new Date("2049-06-01T01:00:00Z");
        const over = yield* draftWithInvitations(
          "2049-04-30T21:00+02:00[Europe/Oslo]",
        );
        const recent = yield* draftWithInvitations(
          "2049-05-22T21:00+02:00[Europe/Oslo]",
        );
        const open = yield* draftWithInvitations();
        assert.strictEqual(yield* invitationsOf(over), 2);

        yield* SignupRetention.deleteSignups(now);

        assert.strictEqual(yield* invitationsOf(over), 0);
        assert.strictEqual(yield* invitationsOf(recent), 2);
        assert.strictEqual(yield* invitationsOf(open), 2);
      }),
  );
});
