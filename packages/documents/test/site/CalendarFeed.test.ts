import {
  NodeFileSystem,
  NodeHttpPlatform,
  NodeServices,
} from "@effect/platform-node";
import { assert, layer } from "@effect/vitest";
import { Identity } from "@skjera/oauth/api";
import { ConfigProvider, Effect, FileSystem, Layer } from "effect";
import { HttpRouter, HttpStaticServer } from "effect/http";
import { SqlClient } from "effect/sql";
import { Documents } from "../../src/events/Documents.ts";
import type { DocumentId } from "../../src/Model.ts";
import { Announcements } from "../../src/notices/Announcements.ts";
import { Notifications } from "../../src/notices/Notifications.ts";
import { SalesEvents } from "../../src/notices/SalesEvents.ts";
import * as CalendarFeed from "../../src/site/CalendarFeed.ts";
import { Teams } from "../../src/Teams.ts";
import { TestDatabase } from "../TestDatabase.ts";

// The calendar to subscribe to (`GET /api/subscribe`): which events it
// reads, members-only ones too, and the route beside the app's fallback.

const alice = new Identity({ issuer: "https://idp.example", subject: "alice" });

const TestLayer = Layer.mergeAll(Teams.layer, Documents.layer).pipe(
  Layer.provideMerge(Announcements.layerTest),
  Layer.provideMerge(SalesEvents.layerTest),
  Layer.provideMerge(Notifications.layerTest),
  Layer.provideMerge(TestDatabase),
);

const day = 86_400_000;
const hour = 3_600_000;

let teams = 0;
/**
 * An event as published, in a team of its own (named as given): shown to
 * everyone or to members only, or deleted; open for guests or not, streamed
 * or not, with the place and the summary given.
 */
const publishedEvent = (options: {
  readonly title: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly public?: boolean;
  readonly deleted?: boolean;
  readonly guests?: boolean;
  readonly streamed?: boolean;
  readonly place?: string;
  readonly summary?: string;
  readonly teamName?: string;
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const team = yield* (yield* Teams).create(
      options.teamName ?? `Calendar feed ${++teams}`,
      alice,
    );
    const id = yield* (yield* Documents).create("event", team.id, alice);
    yield* sql`
      INSERT INTO events (id, title, starts_at, ends_at, time_zone, body,
        is_public, allow_guests, ask_dietary, is_streamed, place, summary,
        deleted_at, published_heads, published_by_issuer, published_by_subject)
      VALUES (${id}, ${options.title}, ${options.startsAt}, ${options.endsAt},
        'Europe/Oslo', '[]', ${options.public ?? true},
        ${options.guests ?? false}, false, ${options.streamed ?? false},
        ${options.place ?? null}, ${options.summary ?? null},
        ${options.deleted === true ? new Date() : null}, '{}', 'test', 'test')
    `;
    return id as DocumentId;
  }).pipe(Effect.orDie);

const index =
  '<!doctype html>\n<html>\n<head>\n<title>Skjera</title>\n</head>\n<body><div id="root"></div></body>\n</html>\n';

/** The configuration a test gives the route, as environment variables. */
const configured = (env: Record<string, string>) =>
  ConfigProvider.layer(ConfigProvider.fromUnknown(env));

/**
 * Serves `/api/subscribe` beside the built app: the route, and a static
 * layer that stands in for the app's `GET /*` route, on the test database.
 * `use` sends requests to it, with a method and headers.
 */
const withApi = <A, E, R>(
  env: Record<string, string>,
  use: (
    request: (
      method: string,
      headers?: Record<string, string>,
    ) => Effect.Effect<Response>,
  ) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    yield* fs.writeFileString(`${root}/index.html`, index);
    const sql = yield* SqlClient.SqlClient;
    const app = Layer.mergeAll(
      CalendarFeed.layerHttp,
      HttpStaticServer.layer({
        root,
        spa: true,
        cacheControl: "no-cache",
      }),
    ).pipe(
      Layer.provide(Layer.succeed(SqlClient.SqlClient, sql)),
      Layer.provide(configured(env)),
      Layer.provide(NodeServices.layer),
      Layer.provide(NodeHttpPlatform.layer),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(app, {
      disableLogger: true,
    });
    yield* Effect.addFinalizer(() => Effect.promise(dispose));
    return yield* use((method, headers) =>
      Effect.promise(() =>
        handler(
          new Request("http://localhost/api/subscribe", {
            method,
            ...(headers === undefined ? {} : { headers }),
          }),
        ),
      ),
    );
  }).pipe(Effect.provide(NodeFileSystem.layer), Effect.scoped);

const siteUrl = "https://skjera.example";

/** The ids among `ids` that the feed reads at `now`, in its order. */
const feedAmong = (now: Date, ids: ReadonlyArray<string>) =>
  CalendarFeed.feedEvents(now, { siteUrl }).pipe(
    Effect.map((events) => events.filter((event) => ids.includes(event.id))),
  );

layer(TestLayer, { excludeTestServices: true })(
  "Calendar feed events",
  (it) => {
    it.effect(
      "reads events for members only and ones going on, soonest first",
      () =>
        Effect.gen(function* () {
          const now = new Date("2040-01-10T12:00:00Z");
          const later = yield* publishedEvent({
            title: "In two days",
            startsAt: new Date(now.getTime() + 2 * day),
            endsAt: new Date(now.getTime() + 2 * day + hour),
          });
          const members = yield* publishedEvent({
            title: "Members only",
            startsAt: new Date(now.getTime() + day),
            endsAt: new Date(now.getTime() + day + hour),
            public: false,
          });
          const going = yield* publishedEvent({
            title: "Going on",
            startsAt: new Date(now.getTime() - day),
            endsAt: new Date(now.getTime() + day),
          });
          const events = yield* feedAmong(now, [later, members, going]);
          assert.deepStrictEqual(
            events.map((event) => event.id),
            [going, members, later],
          );
        }),
    );

    it.effect("leaves out ended, deleted and never published events", () =>
      Effect.gen(function* () {
        const now = new Date("2040-01-10T12:00:00Z");
        const ended = yield* publishedEvent({
          title: "Ended",
          startsAt: new Date(now.getTime() - 2 * day),
          endsAt: new Date(now.getTime() - day),
        });
        const endedMembers = yield* publishedEvent({
          title: "Ended, members only",
          startsAt: new Date(now.getTime() - 2 * day),
          endsAt: new Date(now.getTime() - day),
          public: false,
        });
        const deleted = yield* publishedEvent({
          title: "Deleted",
          startsAt: new Date(now.getTime() + 2 * day),
          endsAt: new Date(now.getTime() + 2 * day + hour),
          deleted: true,
        });
        const team = yield* (yield* Teams).create("Never published", alice);
        const draft = yield* (yield* Documents).create("event", team.id, alice);
        const events = yield* feedAmong(now, [
          ended,
          endedMembers,
          deleted,
          draft,
        ]);
        assert.deepStrictEqual(events, []);
      }),
    );

    it.effect(
      "gives an event its title, times, place, summary and page, and leaves out what it lacks",
      () =>
        Effect.gen(function* () {
          const now = new Date("2060-01-10T12:00:00Z");
          const startsAt = new Date(now.getTime() + day);
          const endsAt = new Date(startsAt.getTime() + hour);
          const full = yield* publishedEvent({
            title: "Full",
            startsAt,
            endsAt,
            place: "Bryggen",
            summary: "An evening",
          });
          const bare = yield* publishedEvent({
            title: "Bare",
            startsAt: new Date(startsAt.getTime() + hour),
            endsAt: new Date(endsAt.getTime() + hour),
          });
          const events = yield* feedAmong(now, [full, bare]);
          assert.deepStrictEqual(events, [
            {
              id: full,
              title: "Full",
              startsAt,
              endsAt,
              url: `https://skjera.example/events/${full}`,
              place: "Bryggen",
              summary: "An evening",
            },
            {
              id: bare,
              title: "Bare",
              startsAt: new Date(startsAt.getTime() + hour),
              endsAt: new Date(endsAt.getTime() + hour),
              url: `https://skjera.example/events/${bare}`,
            },
          ]);
        }),
    );
  },
);

layer(TestLayer, { excludeTestServices: true })("Calendar feed route", (it) => {
  it.effect(
    "answers anyone with the calendar, named after SITE_NAME, members-only events too, beside the app's fallback (AC-1)",
    () =>
      Effect.gen(function* () {
        // The route reads the real clock.
        const members = yield* publishedEvent({
          title: "Members only",
          startsAt: new Date(Date.now() + day),
          endsAt: new Date(Date.now() + day + hour),
          public: false,
        });
        yield* withApi(
          {
            SITE_URL: siteUrl,
            SITE_NAME: "Example Events",
            SITE_LOCALE: "nb",
          },
          (request) =>
            Effect.gen(function* () {
              const response = yield* request("GET");
              assert.strictEqual(response.status, 200);
              assert.strictEqual(
                response.headers.get("content-type"),
                "text/calendar; charset=utf-8",
              );
              const body = yield* Effect.promise(() => response.text());
              assert.match(body, /^X-WR-CALNAME:Example Events\r?$/m);
              assert.include(body, `UID:${members}@skjera.example`);
            }),
        );
      }),
  );

  it.effect("names the calendar Skjera without SITE_NAME (AC-2)", () =>
    Effect.gen(function* () {
      yield* withApi({ SITE_URL: siteUrl }, (request) =>
        Effect.gen(function* () {
          const response = yield* request("GET");
          assert.strictEqual(response.status, 200);
          const body = yield* Effect.promise(() => response.text());
          assert.match(body, /^X-WR-CALNAME:Skjera\r?$/m);
        }),
      );
    }),
  );

  it.effect(
    "gives no calendar, and leaves the path to the app's fallback, without SITE_URL",
    () =>
      Effect.gen(function* () {
        yield* publishedEvent({
          title: "Tomorrow",
          startsAt: new Date(Date.now() + day),
          endsAt: new Date(Date.now() + day + hour),
        });
        yield* withApi({}, (request) =>
          Effect.gen(function* () {
            // The fallback serves the page to a request that asks for HTML.
            const response = yield* request("GET", { Accept: "text/html" });
            assert.strictEqual(
              yield* Effect.promise(() => response.text()),
              index,
            );
          }),
        );
      }),
  );
});
