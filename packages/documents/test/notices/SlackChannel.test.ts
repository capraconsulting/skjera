import * as A from "@automerge/automerge";
import { NodeCrypto } from "@effect/platform-node";
import { assert, describe, it, layer } from "@effect/vitest";
import { Identity } from "@skjera/oauth/api";
import { SlackApiError, SlackUnavailable } from "@skjera/slack";
import * as SlackTest from "@skjera/slack/testing";
import { ConfigProvider, Cron, Effect, Layer, Logger, Schedule } from "effect";
import { SingleRunner } from "effect/cluster";
import { SqlClient } from "effect/sql";
import type { EventContent } from "../../src/events/ContentTypes.ts";
import { Documents } from "../../src/events/Documents.ts";
import { type DocumentId, SiteSettings } from "../../src/Model.ts";
import { Announcements } from "../../src/notices/Announcements.ts";
import { formatAt } from "../../src/notices/emails/format.ts";
import { Notifications } from "../../src/notices/Notifications.ts";
import { SalesEvents } from "../../src/notices/SalesEvents.ts";
import * as SlackChannel from "../../src/notices/SlackChannel.ts";
import { Teams } from "../../src/Teams.ts";
import { TestDatabase } from "../TestDatabase.ts";

// What Slack is told of: the two messages, the deadlines due, and the
// channel that posts them, on a cluster on the test database and a Slack
// workspace in memory. Each test of a block that shares a database has a
// `now` on a date of its own, and counts only messages naming its own events.

const alice = new Identity({ issuer: "https://idp.example", subject: "alice" });
const site = {
  url: "https://skjera.example",
  locale: "en",
  timeZone: "Europe/Oslo",
} as const;
const oslo = "Europe/Oslo";

/** Every string in a message, however deep. */
const leaves = (value: unknown): ReadonlyArray<string> => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(leaves);
  }
  return [];
};

const blockOfType = (
  blocks: ReadonlyArray<{ readonly type: string }>,
  type: string,
) =>
  blocks.find((block) => block.type === type) as
    | Record<string, unknown>
    | undefined;

describe("The messages", () => {
  const imageId = "AAAAAAAAAAAAAAAAAAAAAA";
  const launch = {
    id: "0190a000-0000-7000-8000-000000000001",
    title: "Launch",
    summary: "An evening",
    cover: { src: `/api/images/${imageId}`, alt: "The stage" },
    startsAt: new Date("2036-10-15T16:00:00Z"),
    place: "Kantina",
    category: null,
  };

  it("announces an event with its cover, summary, link, time and place", () => {
    const message = SlackChannel.announcement(launch, site);
    const heading = "*Launch | <!here> :loudspeaker:*";
    assert.strictEqual(message.text, heading);
    assert.deepStrictEqual(leaves(message.blocks[0]), [
      "section",
      "mrkdwn",
      heading,
    ]);
    const image = blockOfType(message.blocks, "image");
    assert.strictEqual(
      image?.image_url,
      `https://skjera.example/api/images/${imageId}`,
    );
    assert.strictEqual(image?.alt_text, "The stage");
    assert.include(
      leaves(blockOfType(message.blocks, "context")),
      "_An evening_",
    );
    const words = leaves(message.blocks);
    assert.include(
      words,
      `*Sign up:*\n<https://skjera.example/events/${launch.id}|Sign up here>`,
    );
    assert.include(words, `*When:*\n${formatAt("en", launch.startsAt, oslo)}`);
    assert.include(words, "*Where:*\nKantina");
  });

  it("shows the cover's cropped part as the image, and the picture without one (AC-2, AC-4)", () => {
    const part = "BBBBBBBBBBBBBBBBBBBBBB";
    const cropped = SlackChannel.announcement(
      {
        ...launch,
        cover: {
          src: `/api/images/${imageId}`,
          alt: "The stage",
          crop: {
            x: 0,
            y: 0,
            width: 0.5,
            height: 1,
            from: `/api/images/${imageId}`,
            src: `/api/images/${part}`,
          },
        },
      },
      site,
    );
    assert.strictEqual(
      blockOfType(cropped.blocks, "image")?.image_url,
      `https://skjera.example/api/images/${part}`,
    );
    assert.strictEqual(
      blockOfType(SlackChannel.announcement(launch, site).blocks, "image")
        ?.image_url,
      `https://skjera.example/api/images/${imageId}`,
    );
  });

  it("gives the event's category beside when and where, in the site's language (AC-9)", () => {
    const words = leaves(
      SlackChannel.announcement({ ...launch, category: "Fag" }, site).blocks,
    );
    assert.include(words, "*Category:*\nFag");
    const norwegian = leaves(
      SlackChannel.announcement(
        { ...launch, category: "Sosialt" },
        { ...site, locale: "nb" },
      ).blocks,
    );
    assert.include(norwegian, "*Kategori:*\nSosialt");
  });

  it("gives no category for an event without one (AC-9)", () => {
    const words = leaves(SlackChannel.announcement(launch, site).blocks);
    assert.isFalse(words.some((word) => word.startsWith("*Category:*")));
  });

  it("marks an event moved on to its next date with :repeat: in place of :loudspeaker:, and changes nothing else", () => {
    const first = SlackChannel.announcement(launch, site);
    const repeated = SlackChannel.announcement(launch, site, {
      repeated: true,
    });
    const heading = "*Launch | <!here> :repeat:*";
    assert.strictEqual(repeated.text, heading);
    assert.deepStrictEqual(leaves(repeated.blocks[0]), [
      "section",
      "mrkdwn",
      heading,
    ]);
    assert.deepStrictEqual(repeated.blocks.slice(1), first.blocks.slice(1));
  });

  it("leaves out what the event lacks, and names a cover by the title when its alt is blank", () => {
    const bare = SlackChannel.announcement(
      { ...launch, summary: null, cover: null, place: null },
      site,
    );
    assert.isUndefined(blockOfType(bare.blocks, "image"));
    assert.isUndefined(blockOfType(bare.blocks, "context"));
    const words = leaves(bare.blocks);
    assert.isFalse(words.some((word) => word.startsWith("*Where:*")));
    assert.include(
      words,
      `*Sign up:*\n<https://skjera.example/events/${launch.id}|Sign up here>`,
    );
    assert.include(words, `*When:*\n${formatAt("en", launch.startsAt, oslo)}`);

    const blank = SlackChannel.announcement(
      { ...launch, cover: { src: launch.cover.src, alt: "  " } },
      site,
    );
    assert.strictEqual(blockOfType(blank.blocks, "image")?.alt_text, "Launch");
  });

  it("escapes the event's words for Slack, so a title cannot mention the channel", () => {
    const message = SlackChannel.announcement(
      { ...launch, title: "Q&A <!channel>", place: "R&D <lab>" },
      site,
    );
    assert.strictEqual(
      message.text,
      "*Q&amp;A &lt;!channel&gt; | <!here> :loudspeaker:*",
    );
    const words = leaves(message.blocks);
    assert.include(words, "*Where:*\nR&amp;D &lt;lab&gt;");
    assert.isFalse(words.some((word) => word.includes("<!channel>")));
  });

  it("lists the deadlines in the order given, each in Norwegian time", () => {
    const first = {
      id: "0190a000-0000-7000-8000-000000000002",
      title: "Early",
      deadline: new Date("2036-10-13T10:00:00Z"),
    };
    const second = {
      id: "0190a000-0000-7000-8000-000000000003",
      title: "Late",
      deadline: new Date("2036-10-13T14:00:00Z"),
    };
    const message = SlackChannel.deadlineMessage([first, second], site);
    const heading = "*Sign-up deadlines are near | <!channel> :alarm_clock:*";
    assert.strictEqual(message.text, heading);
    assert.include(leaves(message.blocks[0]), heading);
    const lines = message.blocks
      .slice(1)
      .flatMap(leaves)
      .filter((line) => line.includes("/events/"));
    assert.deepStrictEqual(
      lines,
      [first, second].map(
        ({ id, title, deadline }) =>
          `<https://skjera.example/events/${id}|${title}> – ${formatAt("en", deadline, oslo)}`,
      ),
    );
    assert.include(lines[0] ?? "", "12:00");
    assert.include(lines[1] ?? "", "4:00 PM");
  });

  it("runs at 07:00 UTC whatever zone the process is in", () => {
    const before = process.env.TZ;
    process.env.TZ = oslo;
    try {
      assert.strictEqual(
        Cron.next(
          SlackChannel.deadlineSchedule,
          new Date("2026-03-30T06:30:00Z"),
        ).toISOString(),
        "2026-03-30T07:00:00.000Z",
      );
      assert.strictEqual(
        Cron.next(
          SlackChannel.deadlineSchedule,
          new Date("2026-03-30T07:00:01Z"),
        ).toISOString(),
        "2026-03-31T07:00:00.000Z",
      );
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });
});

const cluster = SingleRunner.layer({
  shardingConfig: {
    entityMessagePollInterval: "50 millis",
    entityReplyPollInterval: "50 millis",
  },
}).pipe(Layer.provide(NodeCrypto.layer));

/** The channel's workspace: the bot is in `C1`. */
const newWorkspace = () =>
  SlackTest.make({ channels: [{ id: "C1", name: "events" }] });
type Workspace = ReturnType<typeof newWorkspace>;

/** The channel's messages, as one string each. */
const textsOf = (workspace: Workspace) =>
  workspace
    .messages("C1")
    .map((message) => JSON.stringify([message.text, message.blocks]));

/** The messages naming `needle`, once there are `count`. */
const postedAbout = (workspace: Workspace, needle: string, count = 1) =>
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

/** The log's entries, as one string each, once one has `needle`. */
const logged = (log: ReadonlyArray<string>, needle: string) =>
  Effect.sync(() => log.filter((entry) => entry.includes(needle))).pipe(
    Effect.filterOrFail(
      (found) => found.length > 0,
      () => "not yet",
    ),
    Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 200 }),
    Effect.orDie,
  );

/** A logger that keeps what is logged, in `log`. */
const keeping = (log: Array<string>) =>
  Logger.layer([
    Logger.make(({ logLevel, message }) => {
      log.push(`${logLevel} ${JSON.stringify(message)}`);
    }),
  ]);

/** The channel's server layer, given its settings as environment variables. */
const configured = (env: Record<string, string>) => {
  const provider = ConfigProvider.layer(ConfigProvider.fromUnknown(env));
  return Layer.merge(
    provider,
    SiteSettings.layer.pipe(Layer.provide(provider)),
  );
};

let teams = 0;
let titles = 0;
/** A title of its own, so a message names its event. */
const newTitle = () => `Launch ${++titles} ${crypto.randomUUID()}`;

/** An event as published, put in the table by hand. */
const insertEvent = (
  options: {
    readonly title?: string;
    readonly startsAt?: Date;
    /** Null: none set, sign-up closes at the start. */
    readonly deadline?: Date | null;
    readonly isPublic?: boolean;
    readonly deleted?: boolean;
    readonly cover?: { readonly src: string; readonly alt: string };
    readonly tags?: ReadonlyArray<string>;
  } = {},
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const team = yield* (yield* Teams).create(`Slack ${++teams}`, alice);
    const id = yield* (yield* Documents).create("event", team.id, alice);
    const title = options.title ?? newTitle();
    const startsAt = options.startsAt ?? new Date("2036-10-15T16:00:00Z");
    const endsAt = new Date(startsAt.getTime() + 3 * 60 * 60 * 1000);
    const isPublic = options.isPublic ?? true;
    yield* sql`
      INSERT INTO events (id, title, starts_at, ends_at, signup_deadline, time_zone,
        body, cover, is_public, allow_guests, ask_dietary, send_reminders, place,
        summary, published_heads, published_by_issuer, published_by_subject,
        deleted_at, tags)
      VALUES (${id}, ${title}, ${startsAt}, ${endsAt}, ${options.deadline ?? null},
        'Europe/Oslo', '[]', ${options.cover === undefined ? null : JSON.stringify(options.cover)}::jsonb,
        ${isPublic}, ${isPublic}, false, true, 'Kantina', 'An evening', '{}', 'test',
        'test', ${options.deleted === true ? new Date() : null},
        ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(options.tags ?? [])}::jsonb)))
    `;
    return { id: id as DocumentId, title };
  }).pipe(Effect.orDie);

/** An event due: its deadline `hours` after `now`, starting a day later. */
const dueIn = (now: Date, hours: number, isPublic = true) => {
  const deadline = new Date(now.getTime() + hours * 60 * 60 * 1000);
  return insertEvent({
    deadline,
    isPublic,
    startsAt: new Date(deadline.getTime() + 24 * 60 * 60 * 1000),
  });
};

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
      (yield* (yield* Teams).create(`Slack ${++teams}`, alice)).id,
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
    const publication = yield* documents.publish(id, heads, alice);
    return { id: id as DocumentId, publication };
  }).pipe(Effect.orDie);

/** The channel on a cluster, the workspace `workspace` and the test database. */
const channelLayer = (workspace: Workspace, log?: Array<string>) =>
  Layer.suspend(() =>
    Layer.mergeAll(
      Documents.layer,
      Teams.layer,
      SlackChannel.poster({ channel: "C1", site }),
    ).pipe(
      Layer.provideMerge(SlackChannel.layerAnnouncements),
      Layer.provideMerge(Notifications.layerTest),
      Layer.provideMerge(SalesEvents.layerTest),
      Layer.provideMerge(workspace.layer),
      Layer.provideMerge(cluster),
      Layer.provideMerge(TestDatabase),
      Layer.provideMerge(log === undefined ? Layer.empty : keeping(log)),
    ),
  );

const workspace = newWorkspace();

// Real clock: these tests talk to a real database.
layer(channelLayer(workspace), { excludeTestServices: true })(
  "The channel",
  (it) => {
    it.effect("posts an event published for the first time", () =>
      Effect.gen(function* () {
        const title = newTitle();
        yield* publishFromDraft(title);
        const [message] = yield* postedAbout(workspace, title);
        assert.include(message?.text ?? "", "<!here>");
        assert.include(message?.text ?? "", title);
      }),
    );

    it.effect("posts the category of an event with the tag Fag (AC-9)", () =>
      Effect.gen(function* () {
        const title = newTitle();
        const { id } = yield* insertEvent({ title, tags: ["Workshop", "FAG"] });
        yield* (yield* Announcements).eventPublished(id);
        const [message] = yield* postedAbout(workspace, title);
        assert.include(leaves(message?.blocks), "*Category:*\nFag");
      }),
    );

    it.effect("posts no category for an event without such a tag (AC-9)", () =>
      Effect.gen(function* () {
        const title = newTitle();
        const { id } = yield* insertEvent({ title, tags: ["Workshop"] });
        yield* (yield* Announcements).eventPublished(id);
        const [message] = yield* postedAbout(workspace, title);
        assert.isFalse(
          leaves(message?.blocks).some((word) =>
            word.startsWith("*Category:*"),
          ),
        );
      }),
    );

    it.effect(
      "reads the deadlines due within a day, soonest first, members-only ones too",
      () =>
        Effect.gen(function* () {
          const now = new Date("2041-03-05T07:00:00Z");
          const soon = yield* dueIn(now, 2);
          const late = yield* dueIn(now, 23);
          const far = yield* dueIn(now, 25);
          const past = yield* dueIn(now, -1);
          const members = yield* dueIn(now, 3, false);
          const own: ReadonlyArray<string> = [
            soon,
            late,
            far,
            past,
            members,
          ].map(({ id }) => id);
          const due = (yield* SlackChannel.dueDeadlines(now)).filter(({ id }) =>
            own.includes(id),
          );
          assert.deepStrictEqual(
            due.map(({ id }) => id),
            [soon.id, members.id, late.id],
          );
          assert.strictEqual(
            due[0]?.deadline.getTime(),
            now.getTime() + 2 * 60 * 60 * 1000,
          );
        }),
    );

    it.effect(
      "reads every event that closes for sign-up within a day, at its deadline or at its start, soonest first (AC-8)",
      () =>
        Effect.gen(function* () {
          const now = new Date("2042-03-05T07:00:00Z");
          const hours = (count: number) =>
            new Date(now.getTime() + count * 60 * 60 * 1000);
          const atStart = yield* insertEvent({
            deadline: null,
            startsAt: hours(10),
          });
          const withDeadline = yield* dueIn(now, 5);
          const farDeadline = yield* dueIn(now, 30);
          const farStart = yield* insertEvent({
            deadline: null,
            startsAt: hours(30),
          });
          const deleted = yield* insertEvent({
            deadline: hours(5),
            startsAt: hours(29),
            deleted: true,
          });
          const own = [atStart, withDeadline, farDeadline, farStart, deleted];
          const found = (yield* SlackChannel.dueDeadlines(now)).filter(
            ({ id }) => own.some((event) => event.id === id),
          );
          assert.deepStrictEqual(
            found.map(({ id }) => id),
            [withDeadline.id, atStart.id],
          );
          assert.strictEqual(found[0]?.deadline.getTime(), hours(5).getTime());
          assert.strictEqual(found[1]?.deadline.getTime(), hours(10).getTime());
        }),
    );

    it.effect("posts one message listing the deadlines due", () =>
      Effect.gen(function* () {
        const now = new Date("2043-03-05T07:00:00Z");
        const first = yield* dueIn(now, 2);
        const second = yield* dueIn(now, 5);
        yield* SlackChannel.postDeadlines(now);
        const [message] = yield* postedAbout(workspace, first.title);
        assert.include(message?.text ?? "", "<!channel>");
        const words = leaves(message?.blocks);
        for (const { id, title } of [first, second]) {
          assert.isTrue(
            words.some((word) =>
              word.includes(`https://skjera.example/events/${id}|${title}`),
            ),
          );
        }
      }),
    );

    it.effect("posts no deadline message when none is due", () =>
      Effect.gen(function* () {
        const now = new Date("2044-03-05T07:00:00Z");
        const far = yield* dueIn(now, 25);
        const before = textsOf(workspace).length;
        yield* SlackChannel.postDeadlines(now);
        yield* Effect.sleep("300 millis");
        assert.strictEqual(textsOf(workspace).length, before);
        assert.isFalse(
          textsOf(workspace).some((text) => text.includes(far.title)),
        );
      }),
    );

    it.effect(
      "posts a day's deadline message once, however often it is sent",
      () =>
        Effect.gen(function* () {
          const now = new Date("2045-03-05T07:00:00Z");
          const today = yield* dueIn(now, 2);
          yield* SlackChannel.postDeadlines(now);
          yield* SlackChannel.postDeadlines(now);
          yield* postedAbout(workspace, today.title);
          yield* Effect.sleep("500 millis");
          assert.strictEqual(
            (yield* postedAbout(workspace, today.title)).length,
            1,
          );

          const nextDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          const tomorrow = yield* dueIn(nextDay, 3);
          yield* SlackChannel.postDeadlines(nextDay);
          const both = yield* postedAbout(workspace, tomorrow.title);
          assert.strictEqual(both.length, 1);
          assert.isFalse(JSON.stringify(both[0]?.blocks).includes(today.title));
        }),
    );
  },
);

const failing = newWorkspace();
const failingLog: Array<string> = [];

layer(channelLayer(failing, failingLog), { excludeTestServices: true })(
  "The channel when Slack fails",
  (it) => {
    it.effect("still publishes, logs a refusal, and posts the next event", () =>
      Effect.gen(function* () {
        failing.failNext(
          "postMessage",
          new SlackApiError({
            method: "chat.postMessage",
            code: "not_in_channel",
          }),
        );
        const refused = newTitle();
        const { publication } = yield* publishFromDraft(refused);
        assert.isDefined(publication);
        yield* logged(failingLog, "not_in_channel");
        assert.isFalse(textsOf(failing).some((text) => text.includes(refused)));

        const next = newTitle();
        yield* publishFromDraft(next);
        yield* postedAbout(failing, next);
      }),
    );

    it.effect(
      "posts after a retry when Slack is unreachable once",
      () =>
        Effect.gen(function* () {
          const title = newTitle();
          const { id } = yield* insertEvent({ title });
          failing.failNext(
            "postMessage",
            new SlackUnavailable({
              method: "chat.postMessage",
              message: "down",
            }),
          );
          yield* (yield* Announcements).eventPublished(id);
          const posted = yield* postedAbout(failing, title);
          assert.strictEqual(posted.length, 1);
        }),
      20_000,
    );

    it.effect(
      "posts the event again without its cover when Slack refuses the blocks",
      () =>
        Effect.gen(function* () {
          const title = newTitle();
          const { id } = yield* insertEvent({
            title,
            cover: { src: "/api/images/AAAAAAAAAAAAAAAAAAAAAA", alt: "Webp" },
          });
          failing.failNext(
            "postMessage",
            new SlackApiError({
              method: "chat.postMessage",
              code: "invalid_blocks",
            }),
          );
          yield* (yield* Announcements).eventPublished(id);
          const posted = yield* postedAbout(failing, title);
          assert.strictEqual(posted.length, 1);
          assert.isUndefined(blockOfType(posted[0]?.blocks ?? [], "image"));
          yield* logged(failingLog, "invalid_blocks");
        }),
    );
  },
);

/** The channel's server layer with `env` as its settings, on the cluster. */
const unconfiguredLayer = (env: Record<string, string>, log: Array<string>) =>
  Layer.suspend(() =>
    Layer.mergeAll(
      Documents.layer,
      Teams.layer,
      SlackChannel.layer.pipe(Layer.provide(configured(env))),
    ).pipe(
      Layer.provideMerge(SlackChannel.layerAnnouncements),
      Layer.provideMerge(Notifications.layerTest),
      Layer.provideMerge(SalesEvents.layerTest),
      Layer.provideMerge(cluster),
      Layer.provideMerge(TestDatabase),
      Layer.provideMerge(keeping(log)),
    ),
  );

for (const [name, env] of [
  ["the channel", { SLACK_BOT_TOKEN: "xoxb-test", SITE_URL: site.url }],
  ["the bot token", { SLACK_CHANNEL: "C1", SITE_URL: site.url }],
] as const) {
  const log: Array<string> = [];
  layer(unconfiguredLayer(env, log), { excludeTestServices: true })(
    `Without ${name}`,
    (it) => {
      it.effect("warns, publishes as before and posts nothing", () =>
        Effect.gen(function* () {
          const { publication } = yield* publishFromDraft(newTitle());
          assert.isDefined(publication);
          yield* logged(log, "nothing is posted to Slack");
          yield* logged(log, "Slack message not posted (not configured)");
        }),
      );
    },
  );
}
