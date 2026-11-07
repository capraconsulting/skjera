import {
  NodeFileSystem,
  NodeHttpPlatform,
  NodeServices,
} from "@effect/platform-node";
import { assert, layer } from "@effect/vitest";
import { Identity } from "@skjera/oauth/api";
import { ConfigProvider, Effect, Exit, FileSystem, Layer } from "effect";
import { HttpRouter, HttpStaticServer } from "effect/http";
import { SqlClient } from "effect/sql";
import { Documents } from "../../src/events/Documents.ts";
import { type DocumentId, SiteSettings } from "../../src/Model.ts";
import { Announcements } from "../../src/notices/Announcements.ts";
import { Notifications } from "../../src/notices/Notifications.ts";
import { SalesEvents } from "../../src/notices/SalesEvents.ts";
import * as Embed from "../../src/site/Embed.ts";
import { Teams } from "../../src/Teams.ts";
import { TestDatabase } from "../TestDatabase.ts";

// The embed page the websites show in an iframe: which events it lists, what
// each one shows, the page written from them, the websites that may frame it
// and the route beside the app's fallback.

const alice = new Identity({ issuer: "https://idp.example", subject: "alice" });

const TestLayer = Layer.mergeAll(Teams.layer, Documents.layer).pipe(
  Layer.provideMerge(Announcements.layerTest),
  Layer.provideMerge(SalesEvents.layerTest),
  Layer.provideMerge(Notifications.layerTest),
  Layer.provideMerge(TestDatabase),
);

const day = 86_400_000;
const logo = "/api/images/AAAAAAAAAAAAAAAAAAAAAA";
const darkLogo = "/api/images/BBBBBBBBBBBBBBBBBBBBBB";

let teams = 0;
/**
 * An event as published, in a team of its own: shown to everyone or to
 * members only, or deleted; the team with the logos given.
 */
const publishedEvent = (options: {
  readonly title: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly public?: boolean;
  readonly deleted?: boolean;
  readonly teamName?: string;
  readonly logo?: string;
  readonly logoDark?: string;
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const team = yield* (yield* Teams).create(
      options.teamName ?? `Embed ${++teams}`,
      alice,
    );
    if (options.logo !== undefined || options.logoDark !== undefined) {
      yield* sql`
        UPDATE teams SET logo = ${options.logo ?? null},
          logo_dark = ${options.logoDark ?? null}
        WHERE id = ${team.id}
      `;
    }
    const id = yield* (yield* Documents).create("event", team.id, alice);
    yield* sql`
      INSERT INTO events (id, title, starts_at, ends_at, time_zone, body,
        is_public, allow_guests, ask_dietary, deleted_at, published_heads,
        published_by_issuer, published_by_subject)
      VALUES (${id}, ${options.title}, ${options.startsAt}, ${options.endsAt},
        'Europe/Oslo', '[]', ${options.public ?? true}, false, false,
        ${options.deleted === true ? new Date() : null}, '{}', 'test', 'test')
    `;
    return id as DocumentId;
  }).pipe(Effect.orDie);

/**
 * Events around `now` for choosing the next three: one going on,
 * four starting in 1, 3, 4 and 5 days; and, in 2 days, one shown only to
 * members and one deleted; and one that ended yesterday. Returns the ids of
 * the three that are next, soonest first, and of the others.
 */
const aroundNow = (now: Date) =>
  Effect.gen(function* () {
    const at = (days: number) => new Date(now.getTime() + days * day);
    const hour = 3_600_000;
    const next = [
      yield* publishedEvent({
        title: "Going on",
        startsAt: at(-1),
        endsAt: at(1),
      }),
      yield* publishedEvent({
        title: "In 1 day",
        startsAt: at(1),
        endsAt: new Date(at(1).getTime() + hour),
      }),
      yield* publishedEvent({
        title: "In 3 days",
        startsAt: at(3),
        endsAt: new Date(at(3).getTime() + hour),
      }),
    ];
    const others = [
      yield* publishedEvent({
        title: "In 4 days",
        startsAt: at(4),
        endsAt: new Date(at(4).getTime() + hour),
      }),
      yield* publishedEvent({
        title: "In 5 days",
        startsAt: at(5),
        endsAt: new Date(at(5).getTime() + hour),
      }),
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
    return { next, others };
  });

const withTeam = (
  team: { name: string; logo: string | null; logoDark: string | null },
  event: Partial<Embed.NextEvent> = {},
): Embed.NextEvent => ({
  id: "6f1c2d1e-7a0b-4f7e-9d63-0a1b2c3d4e5f",
  title: "Launch",
  startsAt: new Date("2036-11-15T17:00:00Z"),
  timeZone: "Europe/Oslo",
  team,
  ...event,
});

const nasty = `<script>alert("x")</script> & 'q'`;

/** The configuration a test gives the route, as environment variables. */
const configured = (env: Record<string, string>) => {
  const provider = ConfigProvider.layer(ConfigProvider.fromUnknown(env));
  return Layer.merge(
    provider,
    SiteSettings.layer.pipe(Layer.provide(provider)),
  );
};

const origins = (value: Record<string, string>) =>
  Effect.exit(
    Effect.gen(function* () {
      return yield* Embed.WebsiteOrigins;
    }),
  ).pipe(Effect.provide(configured(value)));

const index =
  '<!doctype html>\n<html>\n<head>\n<title>Skjera</title>\n</head>\n<body><div id="root"></div></body>\n</html>\n';

/**
 * Serves `/embed` beside the built app: the route, and a static layer that
 * stands in for the app's `GET /*` route, on the test database. `use`
 * fetches pages from it.
 */
const withPages = <A, E, R>(
  env: Record<string, string>,
  use: (
    page: (path: string) => Effect.Effect<Response>,
  ) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    yield* fs.writeFileString(`${root}/index.html`, index);
    const sql = yield* SqlClient.SqlClient;
    const app = Layer.mergeAll(
      Embed.layerHttp,
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
    return yield* use((path) =>
      Effect.promise(() => handler(new Request(`http://localhost${path}`))),
    );
  }).pipe(Effect.provide(NodeFileSystem.layer), Effect.scoped);

/** The events a page links to, in the order it lists them. */
const linkedIds = (html: string) =>
  [...html.matchAll(/href="\/events\/([^"]+)"/g)].map((match) => match[1]);

const websites = "https://www.capraconsulting.no, https://liflig.no/";
const frame =
  "frame-ancestors https://www.capraconsulting.no https://liflig.no";

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Embed", (it) => {
  it.effect(
    "reads the next three events shown to everyone, soonest first",
    () =>
      Effect.gen(function* () {
        const now = new Date("2040-01-10T12:00:00Z");
        const { next, others } = yield* aroundNow(now);
        const events = yield* Embed.nextEvents(now);
        assert.deepStrictEqual(
          events.map((event) => event.id),
          next,
        );
        assert.deepStrictEqual(
          events.map((event) => event.title),
          ["Going on", "In 1 day", "In 3 days"],
        );
        for (const other of others) {
          assert.isFalse(
            events.some((event) => event.id === other),
            other,
          );
        }
      }),
  );

  it.effect("reads fewer than three when there are fewer", () =>
    Effect.gen(function* () {
      const later = yield* publishedEvent({
        title: "Later",
        startsAt: new Date("2060-01-12T17:00:00Z"),
        endsAt: new Date("2060-01-12T19:00:00Z"),
      });
      const sooner = yield* publishedEvent({
        title: "Sooner",
        startsAt: new Date("2060-01-11T17:00:00Z"),
        endsAt: new Date("2060-01-11T19:00:00Z"),
      });
      const events = yield* Embed.nextEvents(new Date("2060-01-10T12:00:00Z"));
      assert.deepStrictEqual(
        events.map((event) => event.id),
        [sooner, later],
      );
    }),
  );

  it.effect("reads the team and the time zone of each event", () =>
    Effect.gen(function* () {
      const id = yield* publishedEvent({
        title: "With a team",
        startsAt: new Date("2080-01-11T17:00:00Z"),
        endsAt: new Date("2080-01-11T19:00:00Z"),
        teamName: "Platform",
        logo,
      });
      const [event] = yield* Embed.nextEvents(new Date("2080-01-10T12:00:00Z"));
      assert.strictEqual(event?.id, id);
      assert.strictEqual(event?.timeZone, "Europe/Oslo");
      assert.strictEqual(event?.team.name, "Platform");
      assert.strictEqual(event?.team.logo, logo);
      assert.strictEqual(event?.team.logoDark, null);
    }),
  );

  it.effect("says today's events by the time, others by the day", () =>
    Effect.sync(() => {
      const team = { name: "Platform", logo: null, logoDark: null };
      // 18:00 in Oslo is 17:00 UTC in November.
      const item = (now: string) =>
        Embed.embedItem(
          withTeam(team, { startsAt: new Date("2036-11-15T17:00:00Z") }),
          { locale: "nb", now: new Date(now) },
        );
      assert.strictEqual(item("2036-11-15T08:00:00Z").when, "I dag kl. 18:00");
      assert.strictEqual(
        item("2036-11-10T08:00:00Z").when,
        "15. november 2036",
      );
      assert.strictEqual(
        item("2036-11-10T08:00:00Z").startsAt,
        "2036-11-15T17:00:00.000Z",
      );
    }),
  );

  it.effect("takes today to be the day in the event's own zone", () =>
    Effect.sync(() => {
      const team = { name: "Platform", logo: null, logoDark: null };
      // 18:00 on 16 November in Oslo; at 23:30 UTC it is 00:30 there on the 16th.
      const { when } = Embed.embedItem(
        withTeam(team, { startsAt: new Date("2036-11-16T17:00:00Z") }),
        { locale: "nb", now: new Date("2036-11-15T23:30:00Z") },
      );
      assert.strictEqual(when, "I dag kl. 18:00");
    }),
  );

  it.effect("shows the organiser by the team's light logo or its name", () =>
    Effect.sync(() => {
      const item = (logos: { logo: string | null; logoDark: string | null }) =>
        Embed.embedItem(withTeam({ name: "Platform", ...logos }), {
          locale: "nb",
          now: new Date("2036-11-10T08:00:00Z"),
        });
      assert.deepStrictEqual(item({ logo, logoDark: null }).organizer, {
        name: "Platform",
        logo,
      });
      // The dark logo is made for a dark background; the page is light.
      assert.deepStrictEqual(
        item({ logo: null, logoDark: darkLogo }).organizer,
        {
          name: "Platform",
          logo: null,
        },
      );
      assert.deepStrictEqual(item({ logo: null, logoDark: null }).organizer, {
        name: "Platform",
        logo: null,
      });
    }),
  );

  it.effect("links an event to its page", () =>
    Effect.sync(() => {
      const item = Embed.embedItem(
        withTeam({ name: "Platform", logo: null, logoDark: null }),
        { locale: "nb", now: new Date("2036-11-10T08:00:00Z") },
      );
      assert.strictEqual(
        item.href,
        "/events/6f1c2d1e-7a0b-4f7e-9d63-0a1b2c3d4e5f",
      );
    }),
  );

  it.effect("escapes an event's title and a team's name in the page", () =>
    Effect.sync(() => {
      const now = new Date("2036-11-10T08:00:00Z");
      const items = [
        withTeam({ name: nasty, logo, logoDark: null }, { title: nasty }),
        withTeam({ name: nasty, logo: null, logoDark: null }, { title: nasty }),
      ].map((event) => Embed.embedItem(event, { locale: "nb", now }));
      const html = Embed.embedPage({
        site: { name: nasty, locale: "nb" },
        items,
      });
      assert.notInclude(html, "<script>alert");
      assert.notInclude(html, "</script> &");
      assert.notInclude(html, 'alert("x")');
      assert.include(html, "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    }),
  );

  it.effect("writes an empty list for no events", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* Embed.nextEvents(new Date("2100-01-01T00:00:00Z")),
        [],
      );
      const html = Embed.embedPage({
        site: { name: "Skjera", locale: "nb" },
        items: [],
      });
      assert.deepStrictEqual(linkedIds(html), []);
    }),
  );

  it.effect("reads the websites as their origins", () =>
    Effect.gen(function* () {
      const exit = yield* origins({ WEBSITE_ORIGINS: websites });
      assert.isTrue(Exit.isSuccess(exit));
      const read = Exit.isSuccess(exit) ? exit.value : [];
      assert.deepStrictEqual(read, [
        "https://www.capraconsulting.no",
        "https://liflig.no",
      ]);
      assert.strictEqual(Embed.frameAncestors(read), frame);
      // Spaces separate them too.
      const spaced = yield* origins({
        WEBSITE_ORIGINS: "https://a.example http://localhost:8080",
      });
      assert.deepStrictEqual(Exit.isSuccess(spaced) ? spaced.value : [], [
        "https://a.example",
        "http://localhost:8080",
      ]);
    }),
  );

  it.effect("allows no website to frame the page when none is set", () =>
    Effect.gen(function* () {
      for (const env of [
        {},
        { WEBSITE_ORIGINS: "" },
        { WEBSITE_ORIGINS: " " },
      ]) {
        const exit = yield* origins(env);
        assert.isTrue(Exit.isSuccess(exit));
        const read = Exit.isSuccess(exit) ? exit.value : ["not read"];
        assert.deepStrictEqual(read, []);
        assert.strictEqual(
          Embed.frameAncestors(read),
          "frame-ancestors 'none'",
        );
      }
    }),
  );

  it.effect("refuses a website that is not a bare origin", () =>
    Effect.gen(function* () {
      for (const value of [
        "capraconsulting.no",
        "ftp://capraconsulting.no",
        "https://capraconsulting.no/events",
        "https://capraconsulting.no;",
        "https://user@capraconsulting.no",
        "https://capraconsulting.no?a=b",
        // One bad value among good ones stops it too.
        "https://liflig.no https://capraconsulting.no;",
      ]) {
        const exit = yield* origins({ WEBSITE_ORIGINS: value });
        assert.isTrue(Exit.isFailure(exit), value);
      }
    }),
  );
});

layer(TestLayer, { excludeTestServices: true })("Embed route", (it) => {
  it.effect("answers with an empty list when no event matches", () =>
    withPages({ WEBSITE_ORIGINS: websites }, (page) =>
      Effect.gen(function* () {
        const response = yield* page("/embed");
        assert.strictEqual(response.status, 200);
        assert.include(response.headers.get("content-type") ?? "", "text/html");
        const html = yield* Effect.promise(() => response.text());
        assert.deepStrictEqual(linkedIds(html), []);
      }),
    ),
  );

  it.effect(
    "answers with the next three events, beside the app's fallback",
    () =>
      Effect.gen(function* () {
        // The route reads the real clock.
        const now = new Date();
        const { next } = yield* aroundNow(now);
        const tomorrow = new Date(now.getTime() + day).toLocaleDateString(
          "nb",
          {
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: "Europe/Oslo",
          },
        );
        yield* withPages(
          { WEBSITE_ORIGINS: websites, SITE_LOCALE: "nb" },
          (page) =>
            Effect.gen(function* () {
              const response = yield* page("/embed");
              assert.strictEqual(response.status, 200);
              assert.include(
                response.headers.get("content-type") ?? "",
                "text/html",
              );
              assert.strictEqual(
                response.headers.get("cache-control"),
                "no-cache",
              );
              const html = yield* Effect.promise(() => response.text());
              assert.deepStrictEqual(linkedIds(html), next);
              // In the site's language.
              assert.include(html, tomorrow);
              // The app's other pages are still the fallback's.
              const other = yield* page("/");
              assert.strictEqual(
                yield* Effect.promise(() => other.text()),
                index,
              );
            }),
        );
      }),
  );

  it.effect("lets only the websites frame the page", () =>
    Effect.gen(function* () {
      yield* withPages({ WEBSITE_ORIGINS: websites }, (page) =>
        Effect.gen(function* () {
          const response = yield* page("/embed");
          assert.strictEqual(
            response.headers.get("content-security-policy"),
            frame,
          );
        }),
      );
      yield* withPages({}, (page) =>
        Effect.gen(function* () {
          const response = yield* page("/embed");
          assert.strictEqual(
            response.headers.get("content-security-policy"),
            "frame-ancestors 'none'",
          );
        }),
      );
    }),
  );

  it.effect("loads nothing from HubSpot, also where the site does", () =>
    withPages({ HUBSPOT_ACCOUNT_ID: "146072525" }, (page) =>
      Effect.gen(function* () {
        const response = yield* page("/embed");
        assert.strictEqual(response.status, 200);
        assert.notInclude(
          yield* Effect.promise(() => response.text()),
          "hs-scripts.com",
        );
      }),
    ),
  );
});
