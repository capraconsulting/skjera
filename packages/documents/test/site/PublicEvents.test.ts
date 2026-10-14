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
import * as PublicEvents from "../../src/site/PublicEvents.ts";
import { Teams } from "../../src/Teams.ts";
import { TestDatabase } from "../TestDatabase.ts";

// The public events API the Capra and Liflig websites read from the browser:
// which events it gives, Skjer's format for each, the websites that may read
// it, and the route beside the app's fallback.

const alice = new Identity({ issuer: "https://idp.example", subject: "alice" });

const TestLayer = Layer.mergeAll(Teams.layer, Documents.layer).pipe(
  Layer.provideMerge(Announcements.layerTest),
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
      options.teamName ?? `Public events ${++teams}`,
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

/** The ids among `ids` that the coming events at `now` give, in their order. */
const comingAmong = (now: Date, ids: ReadonlyArray<string>) =>
  PublicEvents.comingEvents(now).pipe(
    Effect.map((events) => events.filter((event) => ids.includes(event.id))),
  );

const comingEvent = (
  event: Partial<PublicEvents.ComingEvent> = {},
): PublicEvents.ComingEvent => ({
  id: "6f1c2d1e-7a0b-4f7e-9d63-0a1b2c3d4e5f",
  title: "Launch",
  startsAt: new Date("2036-11-15T17:00:00Z"),
  endsAt: new Date("2036-11-15T19:00:00Z"),
  place: "Bryggen",
  summary: "An evening",
  isStreamed: true,
  allowGuests: true,
  teamName: "Platform",
  ...event,
});

const site = { siteUrl: "https://skjera.example" };

const websites = ["https://www.capraconsulting.no", "https://liflig.no"];

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Public events", (it) => {
  it.effect(
    "gives every event shown to everyone that has not ended, soonest first, more than three (AC-1)",
    () =>
      Effect.gen(function* () {
        const now = new Date("2040-01-10T12:00:00Z");
        const at = (days: number) => new Date(now.getTime() + days * day);
        const event = (title: string, from: number, to: number) =>
          publishedEvent({
            title,
            startsAt: at(from),
            endsAt: new Date(at(to).getTime() + hour),
          });
        // Inserted out of order.
        const in4 = yield* event("In 4 days", 4, 4);
        const goingOn = yield* event("Going on", -1, 1);
        const in5 = yield* event("In 5 days", 5, 5);
        const in1 = yield* event("In 1 day", 1, 1);
        const in3 = yield* event("In 3 days", 3, 3);
        const ids = [in4, goingOn, in5, in1, in3];
        const events = yield* comingAmong(now, ids);
        assert.deepStrictEqual(
          events.map((event) => event.id),
          [goingOn, in1, in3, in4, in5],
        );
      }),
  );

  it.effect(
    "leaves out an event shown only to members, a deleted one, one that has ended and one never published (AC-6)",
    () =>
      Effect.gen(function* () {
        const now = new Date("2040-01-10T12:00:00Z");
        const at = (days: number) => new Date(now.getTime() + days * day);
        const shown = yield* publishedEvent({
          title: "Shown",
          startsAt: at(2),
          endsAt: new Date(at(2).getTime() + hour),
        });
        const others = [
          yield* publishedEvent({
            title: "Members only",
            startsAt: at(2),
            endsAt: new Date(at(2).getTime() + hour),
            public: false,
          }),
          yield* publishedEvent({
            title: "Deleted",
            startsAt: at(2),
            endsAt: new Date(at(2).getTime() + hour),
            deleted: true,
          }),
          yield* publishedEvent({
            title: "Ended",
            startsAt: at(-2),
            endsAt: at(-1),
          }),
        ];
        // Created, never published: it has no row in `events`.
        const team = yield* (yield* Teams).create("Never published", alice);
        const draft = yield* (yield* Documents).create("event", team.id, alice);
        const events = yield* comingAmong(now, [shown, ...others, draft]);
        assert.deepStrictEqual(
          events.map((event) => event.id),
          [shown],
        );
      }),
  );

  it.effect(
    "reads each event's place, summary, streaming, guests and team as published (AC-2)",
    () =>
      Effect.gen(function* () {
        const startsAt = new Date("2060-01-11T17:00:00Z");
        const endsAt = new Date("2060-01-11T19:00:00Z");
        const full = yield* publishedEvent({
          title: "Full",
          startsAt,
          endsAt,
          place: "Bryggen",
          summary: "An evening",
          streamed: true,
          guests: true,
          teamName: "Platform",
        });
        const bare = yield* publishedEvent({
          title: "Bare",
          startsAt: new Date(startsAt.getTime() + hour),
          endsAt: new Date(endsAt.getTime() + hour),
          teamName: "Infra",
        });
        const events = yield* comingAmong(new Date("2060-01-10T12:00:00Z"), [
          full,
          bare,
        ]);
        assert.deepStrictEqual(events, [
          {
            id: full,
            title: "Full",
            startsAt,
            endsAt,
            place: "Bryggen",
            summary: "An evening",
            isStreamed: true,
            allowGuests: true,
            teamName: "Platform",
          },
          {
            id: bare,
            title: "Bare",
            startsAt: new Date(startsAt.getTime() + hour),
            endsAt: new Date(endsAt.getTime() + hour),
            place: null,
            summary: null,
            isStreamed: false,
            allowGuests: false,
            teamName: "Infra",
          },
        ]);
      }),
  );

  it.effect(
    "puts an event in Skjer's format with its eleven fields (AC-2)",
    () =>
      Effect.sync(() => {
        assert.deepStrictEqual(PublicEvents.publicEvent(comingEvent(), site), {
          id: "6f1c2d1e-7a0b-4f7e-9d63-0a1b2c3d4e5f",
          title: "Launch",
          start: "2036-11-15T17:00:00.000Z",
          end: "2036-11-15T19:00:00.000Z",
          place: "Bryggen",
          summary: "An evening",
          category: null,
          organisers: "Platform",
          isDigital: true,
          openForExternals: true,
          url: "https://skjera.example/events/6f1c2d1e-7a0b-4f7e-9d63-0a1b2c3d4e5f",
        });
      }),
  );

  it.effect(
    "gives the place as an empty string for an event published before events had a place (AC-2)",
    () =>
      Effect.sync(() => {
        const event = PublicEvents.publicEvent(
          comingEvent({ place: null }),
          site,
        );
        assert.strictEqual(event.place, "");
      }),
  );

  it.effect(
    'gives organisers as "Alle" for the team "Capra Gruppen" in any case and the team\'s name for others (AC-3)',
    () =>
      Effect.sync(() => {
        const organisers = [
          "Capra Gruppen",
          "capra gruppen",
          "Liflig",
          "Capra",
          "Capra Gruppen Oslo",
        ].map(
          (teamName) =>
            PublicEvents.publicEvent(comingEvent({ teamName }), site)
              .organisers,
        );
        assert.deepStrictEqual(organisers, [
          "Alle",
          "Alle",
          "Liflig",
          "Capra",
          "Capra Gruppen Oslo",
        ]);
      }),
  );

  it.effect(
    "gives summary as null when there is none and category as null always (AC-4)",
    () =>
      Effect.sync(() => {
        const without = PublicEvents.publicEvent(
          comingEvent({ summary: null }),
          site,
        );
        const withSummary = PublicEvents.publicEvent(comingEvent(), site);
        assert.isNull(without.summary);
        assert.isNull(without.category);
        assert.strictEqual(withSummary.summary, "An evening");
        assert.isNull(withSummary.category);
      }),
  );

  it.effect(
    "gives isDigital and openForExternals as false when the event is neither (AC-5)",
    () =>
      Effect.sync(() => {
        const event = PublicEvents.publicEvent(
          comingEvent({ isStreamed: false, allowGuests: false }),
          site,
        );
        assert.isFalse(event.isDigital);
        assert.isFalse(event.openForExternals);
      }),
  );

  it.effect(
    "lets a listed website read the answer, and keeps one answer per origin (AC-7)",
    () =>
      Effect.sync(() => {
        assert.deepStrictEqual(
          PublicEvents.corsHeaders("https://www.capraconsulting.no", websites),
          {
            "Access-Control-Allow-Origin": "https://www.capraconsulting.no",
            "Access-Control-Allow-Credentials": "true",
            Vary: "Origin",
          },
        );
        assert.strictEqual(
          PublicEvents.corsHeaders("https://liflig.no", websites)[
            "Access-Control-Allow-Origin"
          ],
          "https://liflig.no",
        );
      }),
  );

  it.effect("lets no other website read the answer (AC-8)", () =>
    Effect.sync(() => {
      for (const origin of [
        "https://capraconsulting.no",
        "https://evil.example",
        undefined,
      ]) {
        assert.deepStrictEqual(PublicEvents.corsHeaders(origin, websites), {
          Vary: "Origin",
        });
      }
      assert.deepStrictEqual(
        PublicEvents.corsHeaders("https://www.capraconsulting.no", []),
        { Vary: "Origin" },
      );
    }),
  );
});

const index =
  '<!doctype html>\n<html>\n<head>\n<title>Skjera</title>\n</head>\n<body><div id="root"></div></body>\n</html>\n';

/** The configuration a test gives the route, as environment variables. */
const configured = (env: Record<string, string>) =>
  ConfigProvider.layer(ConfigProvider.fromUnknown(env));

/**
 * Serves `/api/public/events` as `main.ts` does beside the built app: the
 * route and the app's fallback, on the test database. `use` sends requests
 * to it, with a method and headers.
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
      PublicEvents.layerHttp,
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
          new Request("http://localhost/api/public/events", {
            method,
            ...(headers === undefined ? {} : { headers }),
          }),
        ),
      ),
    );
  }).pipe(Effect.provide(NodeFileSystem.layer), Effect.scoped);

const listed = {
  WEBSITE_ORIGINS: "https://www.capraconsulting.no, https://liflig.no",
  SITE_URL: "https://skjera.example",
};

const skjerHeaders =
  "authorization, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version";

layer(TestLayer, { excludeTestServices: true })("Public events route", (it) => {
  it.effect(
    "answers with the coming events in Skjer's format, beside the app's fallback (AC-1)",
    () =>
      Effect.gen(function* () {
        // The route reads the real clock.
        const startsAt = new Date(Date.now() + day);
        const endsAt = new Date(startsAt.getTime() + hour);
        const shown = yield* publishedEvent({
          title: "Shown",
          startsAt,
          endsAt,
          place: "Bryggen",
          streamed: true,
          guests: true,
          teamName: "Platform",
        });
        const members = yield* publishedEvent({
          title: "Members only",
          startsAt,
          endsAt,
          public: false,
        });
        yield* withApi(listed, (request) =>
          Effect.gen(function* () {
            const response = yield* request("GET");
            assert.strictEqual(response.status, 200);
            assert.include(
              response.headers.get("content-type") ?? "",
              "application/json",
            );
            const body = (yield* Effect.promise(() =>
              response.json(),
            )) as ReadonlyArray<Record<string, unknown>>;
            assert.deepStrictEqual(
              body.filter((event) => event.id === shown),
              [
                {
                  id: shown,
                  title: "Shown",
                  start: startsAt.toISOString(),
                  end: endsAt.toISOString(),
                  place: "Bryggen",
                  summary: null,
                  category: null,
                  organisers: "Platform",
                  isDigital: true,
                  openForExternals: true,
                  url: `https://skjera.example/events/${shown}`,
                },
              ],
            );
            assert.isFalse(body.some((event) => event.id === members));
          }),
        );
      }),
  );

  it.effect(
    "gives no event, and leaves the path to the app's fallback, without SITE_URL (AC-5)",
    () =>
      Effect.gen(function* () {
        yield* publishedEvent({
          title: "Tomorrow",
          startsAt: new Date(Date.now() + day),
          endsAt: new Date(Date.now() + day + hour),
        });
        yield* withApi({ WEBSITE_ORIGINS: listed.WEBSITE_ORIGINS }, (request) =>
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

  it.effect(
    "lets a listed website read the answer and the preflight (AC-7)",
    () =>
      withApi(listed, (request) =>
        Effect.gen(function* () {
          const origin = "https://www.capraconsulting.no";
          const get = yield* request("GET", { Origin: origin });
          assert.strictEqual(get.status, 200);
          assert.strictEqual(
            get.headers.get("access-control-allow-origin"),
            origin,
          );
          assert.strictEqual(
            get.headers.get("access-control-allow-credentials"),
            "true",
          );
          const preflight = yield* request("OPTIONS", {
            Origin: origin,
            "Access-Control-Request-Method": "GET",
          });
          assert.strictEqual(preflight.status, 204);
          assert.strictEqual(
            preflight.headers.get("access-control-allow-origin"),
            origin,
          );
          assert.strictEqual(
            preflight.headers.get("access-control-allow-methods"),
            "GET",
          );
          assert.strictEqual(
            preflight.headers.get("access-control-allow-headers"),
            skjerHeaders,
          );
        }),
      ),
  );

  it.effect(
    "lets no other website read the answer or the preflight (AC-8)",
    () =>
      withApi(listed, (request) =>
        Effect.gen(function* () {
          const headers = { Origin: "https://evil.example" };
          const get = yield* request("GET", headers);
          assert.strictEqual(get.status, 200);
          assert.isNull(get.headers.get("access-control-allow-origin"));
          const preflight = yield* request("OPTIONS", {
            ...headers,
            "Access-Control-Request-Method": "GET",
          });
          assert.isNull(preflight.headers.get("access-control-allow-origin"));
        }),
      ),
  );

  it.effect(
    "allows the answer to be cached for five minutes, per origin (AC-9)",
    () =>
      withApi(listed, (request) =>
        Effect.gen(function* () {
          for (const origin of [
            "https://www.capraconsulting.no",
            "https://evil.example",
          ]) {
            const response = yield* request("GET", { Origin: origin });
            assert.strictEqual(
              response.headers.get("cache-control"),
              "public, max-age=300",
            );
            assert.strictEqual(response.headers.get("vary"), "Origin");
          }
        }),
      ),
  );
});
