import * as A from "@automerge/automerge";
import { NodeCrypto } from "@effect/platform-node";
import { assert, layer } from "@effect/vitest";
import { Identity } from "@skjera/oauth/api";
import * as SlackTest from "@skjera/slack/testing";
import { Effect, Layer, Ref, Schedule } from "effect";
import { SingleRunner } from "effect/cluster";
import { SqlClient } from "effect/sql";
import { Attendance } from "../../../src/attendance/Attendance.ts";
import type { EventContent } from "../../../src/events/ContentTypes.ts";
import { Documents } from "../../../src/events/Documents.ts";
import * as Recurring from "../../../src/events/Recurring.ts";
import type { DocumentId } from "../../../src/Model.ts";
import { formatAt } from "../../../src/notices/emails/format.ts";
import {
  NoticesKept,
  Notifications,
} from "../../../src/notices/Notifications.ts";
import * as SlackChannel from "../../../src/notices/SlackChannel.ts";
import { Teams } from "../../../src/Teams.ts";
import { TestDatabase } from "../../TestDatabase.ts";

// What moving a recurring event on does to it, its signups and the Slack
// channel, on a cluster on the test database and a Slack workspace in
// memory. Tests share a database, so each has a title of its own, a `now`
// after its own events' end, and counts only the messages naming its title.

const alice = new Identity({ issuer: "https://idp.example", subject: "alice" });
const site = { url: "https://skjera.example", locale: "en" } as const;
const oslo = "Europe/Oslo";
const day = 24 * 60 * 60 * 1000;

const cluster = SingleRunner.layer({
  shardingConfig: {
    entityMessagePollInterval: "50 millis",
    entityReplyPollInterval: "50 millis",
  },
}).pipe(Layer.provide(NodeCrypto.layer));

/** The channel's workspace: the bot is in `C1`. */
const newWorkspace = () =>
  SlackTest.make({ channels: [{ id: "C1", name: "events" }] });

const workspace = newWorkspace();

/** The messages naming `needle`, once there are `count` of them. */
const postedAbout = (needle: string, count = 1) =>
  Effect.sync(() =>
    workspace
      .messages("C1")
      .filter((message) =>
        JSON.stringify([message.text, message.blocks]).includes(needle),
      ),
  ).pipe(
    Effect.filterOrFail(
      (found) => found.length >= count,
      () => "not yet",
    ),
    Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 200 }),
    Effect.orDie,
  );

/** The `:repeat:` messages naming the title, as they are now. */
const repeatsAbout = (title: string) =>
  Effect.sync(() =>
    workspace.messages("C1").filter((message) => {
      const text = JSON.stringify([message.text, message.blocks]);
      return text.includes(title) && text.includes(":repeat:");
    }),
  );

/** Lets what was told to the channel be posted, then counts the repeats. */
const settledRepeatsAbout = (title: string) =>
  Effect.gen(function* () {
    yield* postedAbout(title);
    yield* Effect.sleep("400 millis");
    return yield* repeatsAbout(title);
  });

let teams = 0;
let titles = 0;
/** A title of its own, so a message names its event. */
const newTitle = () => `Weekly ${++titles} ${crypto.randomUUID()}`;

/** How an event repeats in its draft; missing keys are left out. */
interface Setting {
  readonly recurring?: boolean;
  readonly every?: number;
  readonly unit?: string;
}

/** The times of the draft, as the editor writes them. */
interface Dates {
  readonly start: string;
  readonly end: string;
  readonly deadline?: string;
  readonly foodDeadline?: string;
}

/** Creates and publishes an event from a draft, the way the studio does. */
const publishEvent = (options: {
  readonly title?: string;
  readonly dates: Dates;
  readonly setting?: Setting;
  readonly dietary?: boolean;
}) =>
  Effect.gen(function* () {
    const documents = yield* Documents;
    const team = yield* (yield* Teams).create(`Recurring ${++teams}`, alice);
    const id = yield* documents.create("event", team.id, alice);
    const title = options.title ?? newTitle();
    const snapshot = yield* documents.get(id);
    let doc = A.load<EventContent>(snapshot.draft);
    doc = A.change(doc, (event) => {
      const draft = event as Record<string, unknown>;
      A.updateText(event, ["title"], title);
      A.updateText(event, ["place"], "Kantina");
      draft.public = true;
      draft.guests = true;
      draft.dietary = options.dietary ?? false;
      const { dates, setting } = options;
      draft.start = new A.ImmutableString(dates.start);
      draft.end = new A.ImmutableString(dates.end);
      if (dates.deadline !== undefined) {
        draft.deadline = new A.ImmutableString(dates.deadline);
      }
      if (dates.foodDeadline !== undefined) {
        draft.foodDeadline = new A.ImmutableString(dates.foodDeadline);
      }
      if (setting?.recurring !== undefined) draft.recurring = setting.recurring;
      if (setting?.every !== undefined) draft.repeatEvery = setting.every;
      if (setting?.unit !== undefined) {
        draft.repeatUnit = new A.ImmutableString(setting.unit);
      }
    });
    const change = A.getLastLocalChange(doc);
    if (change === undefined) throw new Error("no change");
    const heads = yield* documents.applyChanges(id, [change], alice);
    yield* documents.publish(id, heads, alice);
    return { id: id as DocumentId, title };
  }).pipe(Effect.orDie);

/** A weekly event from `date` (`2040-01-05`), 18:00 to 21:00 in Oslo. */
const weekly = (
  date: string,
  options: {
    readonly offset?: string;
    readonly setting?: Setting;
    readonly dietary?: boolean;
    readonly deadline?: string;
    readonly foodDeadline?: string;
  } = {},
) => {
  const { offset = "+01:00" } = options;
  return publishEvent({
    dates: {
      start: `${date}T18:00${offset}[Europe/Oslo]`,
      end: `${date}T21:00${offset}[Europe/Oslo]`,
      ...(options.deadline === undefined ? {} : { deadline: options.deadline }),
      ...(options.foodDeadline === undefined
        ? {}
        : { foodDeadline: options.foodDeadline }),
    },
    setting: options.setting ?? { recurring: true, every: 1, unit: "week" },
    ...(options.dietary === undefined ? {} : { dietary: options.dietary }),
  });
};

interface PublishedRow {
  readonly starts_at: Date;
  readonly ends_at: Date;
  readonly signup_deadline: Date | null;
  readonly food_deadline: Date | null;
  readonly published_heads: ReadonlyArray<string>;
  readonly first_published_at: Date;
}

/** An event as published. */
const publishedRow = (id: DocumentId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<PublishedRow>`
      SELECT starts_at, ends_at, signup_deadline, food_deadline,
        published_heads, first_published_at
      FROM events WHERE id = ${id}
    `;
    if (row === undefined) throw new Error("not published");
    return row;
  }).pipe(Effect.orDie);

/** The draft's times, as strings. */
const draftTimes = (id: DocumentId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ content: Record<string, unknown> }>`
      SELECT draft::jsonb AS content FROM documents WHERE id = ${id}
    `;
    const content = row?.content ?? {};
    return {
      start: content.start,
      end: content.end,
      deadline: content.deadline,
      foodDeadline: content.foodDeadline,
    };
  }).pipe(Effect.orDie);

/** How many signups an event has, counted in the table. */
const signupsOf = (id: DocumentId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ n: number }>`
      SELECT count(*)::int AS n FROM attendees WHERE event_id = ${id}
    `;
    return row?.n ?? 0;
  }).pipe(Effect.orDie);

/** A member and a guest, signed up. */
const signUp = (id: DocumentId, dietary?: string) =>
  Effect.gen(function* () {
    const attendance = yield* Attendance;
    yield* attendance.attend(
      id,
      alice,
      dietary === undefined ? {} : { dietary },
    );
    yield* attendance.attendAsGuest(
      id,
      { name: "Gus", email: `gus-${crypto.randomUUID()}@example.org` },
      dietary === undefined ? {} : { dietary: `${dietary} too` },
    );
  }).pipe(Effect.orDie);

const TestLayer = Layer.mergeAll(
  Documents.layer,
  Teams.layer,
  Attendance.layer,
  SlackChannel.poster({ channel: "C1", site }),
).pipe(
  Layer.provideMerge(SlackChannel.layerAnnouncements),
  Layer.provideMerge(Notifications.layerTest),
  Layer.provideMerge(workspace.layer),
  Layer.provideMerge(cluster),
  Layer.provideMerge(TestDatabase),
);

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Moving events", (it) => {
  it.effect(
    "moves an ended weekly event a week on, in the draft and as published, and publishes it again (AC-2)",
    () =>
      Effect.gen(function* () {
        const { id } = yield* weekly("2040-01-05");
        const before = yield* publishedRow(id);
        yield* Recurring.moveEnded(new Date("2040-01-06T06:30:00Z"));
        const after = yield* publishedRow(id);
        assert.strictEqual(
          after.starts_at.toISOString(),
          "2040-01-12T17:00:00.000Z",
        );
        assert.strictEqual(
          after.ends_at.toISOString(),
          "2040-01-12T20:00:00.000Z",
        );
        assert.notStrictEqual(
          after.published_heads.join(),
          before.published_heads.join(),
        );
        assert.strictEqual(
          after.first_published_at.getTime(),
          before.first_published_at.getTime(),
        );
        const draft = yield* draftTimes(id);
        assert.strictEqual(draft.start, "2040-01-12T18:00+01:00[Europe/Oslo]");
        assert.strictEqual(draft.end, "2040-01-12T21:00+01:00[Europe/Oslo]");
      }),
  );

  it.effect(
    "moves neither an event that is not marked as recurring nor one with recurring off (AC-1)",
    () =>
      Effect.gen(function* () {
        const bare = yield* weekly("2041-01-04", { setting: {} });
        const off = yield* weekly("2041-01-11", {
          setting: { recurring: false, every: 2, unit: "week" },
        });
        yield* signUp(bare.id);
        yield* signUp(off.id);
        const beforeBare = yield* publishedRow(bare.id);
        const beforeOff = yield* publishedRow(off.id);
        yield* Recurring.moveEnded(new Date("2041-01-13T06:30:00Z"));
        for (const [event, before] of [
          [bare, beforeBare],
          [off, beforeOff],
        ] as const) {
          const row = yield* publishedRow(event.id);
          assert.strictEqual(
            row.starts_at.getTime(),
            before.starts_at.getTime(),
          );
          assert.strictEqual(yield* signupsOf(event.id), 2);
          assert.lengthOf(yield* settledRepeatsAbout(event.title), 0);
        }
      }),
  );

  it.effect(
    "moves a recurring event with no interval or unit chosen one week on (AC-1)",
    () =>
      Effect.gen(function* () {
        const { id } = yield* weekly("2042-01-03", {
          setting: { recurring: true },
        });
        yield* Recurring.moveEnded(new Date("2042-01-04T06:30:00Z"));
        const row = yield* publishedRow(id);
        assert.strictEqual(
          row.starts_at.toISOString(),
          "2042-01-10T17:00:00.000Z",
        );
      }),
  );

  it.effect(
    "does not move a recurring event whose end is after now, and keeps its signups (AC-2)",
    () =>
      Effect.gen(function* () {
        const { id, title } = yield* weekly("2043-01-02");
        yield* signUp(id);
        const before = yield* publishedRow(id);
        // Before the end at 20:00 UTC.
        yield* Recurring.moveEnded(new Date("2043-01-02T19:00:00Z"));
        const row = yield* publishedRow(id);
        assert.strictEqual(row.starts_at.getTime(), before.starts_at.getTime());
        assert.strictEqual(yield* signupsOf(id), 2);
        assert.lengthOf(yield* settledRepeatsAbout(title), 0);
      }),
  );

  it.effect(
    "moves the sign-up and food deadlines with the start, in the draft and as published (AC-3)",
    () =>
      Effect.gen(function* () {
        const { id } = yield* weekly("2044-01-07", {
          dietary: true,
          deadline: "2044-01-06T12:00+01:00[Europe/Oslo]",
          foodDeadline: "2044-01-05T12:00+01:00[Europe/Oslo]",
        });
        yield* Recurring.moveEnded(new Date("2044-01-08T06:30:00Z"));
        const row = yield* publishedRow(id);
        assert.strictEqual(
          row.signup_deadline?.toISOString(),
          "2044-01-13T11:00:00.000Z",
        );
        assert.strictEqual(
          row.food_deadline?.toISOString(),
          "2044-01-12T11:00:00.000Z",
        );
        const draft = yield* draftTimes(id);
        assert.strictEqual(
          draft.deadline,
          "2044-01-13T12:00+01:00[Europe/Oslo]",
        );
        assert.strictEqual(
          draft.foodDeadline,
          "2044-01-12T12:00+01:00[Europe/Oslo]",
        );
      }),
  );

  it.effect(
    "removes the signups and the dietary preferences, and emails nobody (AC-5)",
    () =>
      Effect.gen(function* () {
        const kept = yield* NoticesKept;
        const attendance = yield* Attendance;
        const { id } = yield* weekly("2045-01-06", { dietary: true });
        yield* signUp(id, "Vegan");
        assert.lengthOf(yield* attendance.dietaryPreferences(id), 2);
        yield* Recurring.moveEnded(new Date("2045-01-07T06:30:00Z"));
        assert.strictEqual(yield* signupsOf(id), 0);
        assert.deepStrictEqual(yield* attendance.dietaryPreferences(id), []);
        const notices = (yield* Ref.get(kept)).filter(
          (notice) => notice.event === id,
        );
        assert.deepStrictEqual(
          notices.map((notice) => notice.kind),
          // The guest's signup email; the member has no address to write to.
          ["signedUp"],
        );
      }),
  );

  it.effect(
    "posts the move to the channel with @here, :repeat: and the new start in Norwegian time (AC-6)",
    () =>
      Effect.gen(function* () {
        const { title } = yield* weekly("2046-01-05");
        yield* Recurring.moveEnded(new Date("2046-01-06T06:30:00Z"));
        const [message] = yield* postedAbout(`${title}`, 2).pipe(
          Effect.map((all) =>
            all.filter((each) => each.text.includes(":repeat:")),
          ),
        );
        assert.include(message?.text ?? "", "<!here>");
        assert.include(message?.text ?? "", title);
        assert.include(
          JSON.stringify(message?.blocks),
          formatAt("en", new Date("2046-01-12T17:00:00Z"), oslo),
        );
        assert.strictEqual((yield* repeatsAbout(title)).length, 1);
      }),
  );

  it.effect(
    "moves neither a deleted event nor a draft that was never published (AC-7)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const sql = yield* SqlClient.SqlClient;
        const deleted = yield* weekly("2047-01-04");
        // Announced before it's deleted: a deleted event isn't announced.
        yield* postedAbout(deleted.title);
        yield* signUp(deleted.id);
        yield* documents.delete(deleted.id, alice);
        const before = yield* publishedRow(deleted.id);

        const team = yield* (yield* Teams).create(
          `Recurring ${++teams}`,
          alice,
        );
        const draftId = yield* documents.create("event", team.id, alice);
        const draftTitle = newTitle();
        const snapshot = yield* documents.get(draftId);
        const doc = A.change(A.load<EventContent>(snapshot.draft), (event) => {
          const draft = event as Record<string, unknown>;
          A.updateText(event, ["title"], draftTitle);
          draft.recurring = true;
          draft.start = new A.ImmutableString(
            "2047-01-04T18:00+01:00[Europe/Oslo]",
          );
          draft.end = new A.ImmutableString(
            "2047-01-04T21:00+01:00[Europe/Oslo]",
          );
        });
        const change = A.getLastLocalChange(doc);
        if (change === undefined) throw new Error("no change");
        yield* documents.applyChanges(draftId, [change], alice);

        yield* Recurring.moveEnded(new Date("2047-01-05T06:30:00Z"));

        const row = yield* publishedRow(deleted.id);
        assert.strictEqual(row.starts_at.getTime(), before.starts_at.getTime());
        assert.strictEqual(yield* signupsOf(deleted.id), 2);
        const published = yield* sql<{ n: number }>`
          SELECT count(*)::int AS n FROM events WHERE id = ${draftId}
        `;
        assert.strictEqual(published[0]?.n, 0);
        assert.lengthOf(yield* settledRepeatsAbout(deleted.title), 0);
        assert.lengthOf(yield* repeatsAbout(draftTitle), 0);
      }),
  );

  it.effect(
    "moves an event once however many runs find it, and again a week later (AC-8)",
    () =>
      Effect.gen(function* () {
        const { id, title } = yield* weekly("2048-01-03");
        const now = new Date("2048-01-04T06:30:00Z");
        yield* Effect.all(
          [Recurring.moveEnded(now), Recurring.moveEnded(now)],
          { concurrency: 2 },
        );
        yield* Recurring.moveEnded(now);
        const row = yield* publishedRow(id);
        assert.strictEqual(
          row.starts_at.toISOString(),
          "2048-01-10T17:00:00.000Z",
        );
        yield* postedAbout(title, 2);
        yield* Effect.sleep("400 millis");
        assert.strictEqual((yield* repeatsAbout(title)).length, 1);

        yield* Recurring.moveEnded(new Date(now.getTime() + 7 * day));
        const again = yield* publishedRow(id);
        assert.strictEqual(
          again.starts_at.toISOString(),
          "2048-01-17T17:00:00.000Z",
        );
        yield* postedAbout(title, 3);
        yield* Effect.sleep("400 millis");
        assert.strictEqual((yield* repeatsAbout(title)).length, 2);
      }),
  );
});
