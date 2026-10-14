import {
  NodeFileSystem,
  NodeHttpPlatform,
  NodeServices,
} from "@effect/platform-node";
import { assert, layer } from "@effect/vitest";
import { Identity } from "@skjera/oauth/api";
import { Effect, FileSystem, Layer, Option } from "effect";
import { HttpRouter, HttpStaticServer } from "effect/http";
import { SqlClient } from "effect/sql";
import { Documents } from "../../src/events/Documents.ts";
import type { Cover, DocumentId } from "../../src/Model.ts";
import { Announcements } from "../../src/notices/Announcements.ts";
import { Notifications } from "../../src/notices/Notifications.ts";
import * as Sharing from "../../src/site/Sharing.ts";
import { Teams } from "../../src/Teams.ts";
import { TestDatabase } from "../TestDatabase.ts";

// What a link to an event shows: which event it may show, the tags that say
// so, and the page the server answers with. (SITE_URL and SITE_NAME as in
// mise.toml.)

const alice = new Identity({ issuer: "https://idp.example", subject: "alice" });

const TestLayer = Layer.mergeAll(Teams.layer, Documents.layer).pipe(
  Layer.provideMerge(Announcements.layerTest),
  Layer.provideMerge(Notifications.layerTest),
  Layer.provideMerge(TestDatabase),
);

const siteUrl = process.env.SITE_URL ?? "";
const siteName = process.env.SITE_NAME ?? "Skjera";
const site = { name: "Skjera Test", url: "https://skjera.test" };

const cover: Cover = {
  src: "/api/images/AAAAAAAAAAAAAAAAAAAAAA",
  alt: "People at a table",
};

let teams = 0;
/** An event as published: shown to everyone or to members only, or deleted. */
const publishedEvent = (
  options: {
    readonly title?: string;
    readonly summary?: string | null;
    readonly cover?: Cover | null;
    readonly public?: boolean;
    readonly deleted?: boolean;
  } = {},
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const team = yield* (yield* Teams).create(`Sharing ${++teams}`, alice);
    const id = yield* (yield* Documents).create("event", team.id, alice);
    const coverJson =
      options.cover === undefined || options.cover === null
        ? null
        : JSON.stringify(options.cover);
    yield* sql`
      INSERT INTO events (id, title, summary, cover, starts_at, ends_at, time_zone,
        body, is_public, allow_guests, ask_dietary, deleted_at, published_heads,
        published_by_issuer, published_by_subject)
      VALUES (${id}, ${options.title ?? "Launch"}, ${options.summary ?? null},
        ${coverJson}::jsonb, '2036-10-15T18:00+02', '2036-10-15T21:00+02',
        'Europe/Oslo', '[]', ${options.public ?? true}, false, false,
        ${options.deleted === true ? new Date() : null}, '{}', 'test', 'test')
    `;
    return id as DocumentId;
  }).pipe(Effect.orDie);

/** The meta tags of a page's head: name or property, to content. */
const metaOf = (html: string) =>
  new Map(
    [
      ...html.matchAll(
        /<meta\s+(?:property|name)="([^"]*)"\s+content="([^"]*)"\s*\/?>/g,
      ),
    ].map((match) => [match[1] ?? "", match[2] ?? ""]),
  );

/** Text as a browser reads it from an attribute. */
const readEscaped = (text: string) =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&");

const index =
  '<!doctype html>\n<html>\n<head>\n<title>Skjera</title>\n</head>\n<body><div id="root"></div></body>\n</html>\n';

/**
 * Serves `index` as `main.ts` does beside the built app: the event route and
 * the app's fallback, on the test database. `use` fetches pages from it.
 */
const withPages = <A, E, R>(
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
      Sharing.layerHttp({ index: `${root}/index.html` }),
      HttpStaticServer.layer({
        root,
        spa: true,
        cacheControl: "no-cache",
      }),
    ).pipe(
      Layer.provide(Layer.succeed(SqlClient.SqlClient, sql)),
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

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Sharing", (it) => {
  it.effect("gives the tags of an event shown to everyone", () =>
    Effect.gen(function* () {
      const id = yield* publishedEvent({
        title: "Launch",
        summary: "Coffee and a talk.",
        cover,
      });
      const event = yield* Sharing.sharedEvent(id);
      assert.isTrue(Option.isSome(event));
      const meta = metaOf(Sharing.sharingTags({ site, event }));
      assert.strictEqual(meta.get("og:title"), "Launch");
      assert.strictEqual(meta.get("description"), "Coffee and a talk.");
      assert.strictEqual(meta.get("og:description"), "Coffee and a talk.");
      assert.strictEqual(meta.get("og:site_name"), "Skjera Test");
      assert.strictEqual(
        meta.get("og:url"),
        `https://skjera.test/events/${id}`,
      );
      assert.strictEqual(
        meta.get("og:image"),
        "https://skjera.test/api/images/AAAAAAAAAAAAAAAAAAAAAA",
      );
      assert.strictEqual(meta.get("og:image:alt"), "People at a table");
      assert.strictEqual(meta.get("twitter:card"), "summary_large_image");
    }),
  );

  it.effect("gives an event without a summary or a cover only its title", () =>
    Effect.gen(function* () {
      const id = yield* publishedEvent({ title: "Launch" });
      const event = yield* Sharing.sharedEvent(id);
      const meta = metaOf(Sharing.sharingTags({ site, event }));
      assert.strictEqual(meta.get("og:title"), "Launch");
      for (const key of ["description", "og:description", "og:image"]) {
        assert.isFalse(meta.has(key), key);
      }
      assert.isFalse(meta.has("og:image:alt"));
      assert.strictEqual(meta.get("twitter:card"), "summary");
    }),
  );

  it.effect("escapes the event's text in the tags", () =>
    Effect.gen(function* () {
      const nasty = `<script>alert("x")</script> & 'q'`;
      const id = yield* publishedEvent({
        title: nasty,
        summary: nasty,
        cover: { ...cover, alt: nasty },
      });
      const event = yield* Sharing.sharedEvent(id);
      const tags = Sharing.sharingTags({ site, event });
      assert.notInclude(tags, "<script");
      assert.notInclude(tags, "</script");
      const meta = metaOf(tags);
      // Each value reads back as written, and none broke out of its tag.
      assert.strictEqual(readEscaped(meta.get("og:title") ?? ""), nasty);
      assert.strictEqual(readEscaped(meta.get("description") ?? ""), nasty);
      assert.strictEqual(readEscaped(meta.get("og:description") ?? ""), nasty);
      assert.strictEqual(readEscaped(meta.get("og:image:alt") ?? ""), nasty);
      assert.strictEqual(
        tags.match(/<meta /g)?.length,
        [...meta.keys()].length,
      );
    }),
  );

  it.effect("leaves the address and the image out without SITE_URL", () =>
    Effect.gen(function* () {
      const id = yield* publishedEvent({
        title: "Launch",
        summary: "Coffee and a talk.",
        cover,
      });
      const event = yield* Sharing.sharedEvent(id);
      const meta = metaOf(
        Sharing.sharingTags({ site: { name: "Skjera Test" }, event }),
      );
      assert.strictEqual(meta.get("og:title"), "Launch");
      assert.strictEqual(meta.get("og:description"), "Coffee and a talk.");
      assert.isFalse(meta.has("og:url"));
      assert.isFalse(meta.has("og:image"));
      assert.isFalse(meta.has("og:image:alt"));
    }),
  );

  it.effect("leaves a blank alt text out", () =>
    Effect.gen(function* () {
      const id = yield* publishedEvent({ cover: { ...cover, alt: "  " } });
      const event = yield* Sharing.sharedEvent(id);
      const meta = metaOf(Sharing.sharingTags({ site, event }));
      assert.isTrue(meta.has("og:image"));
      assert.isFalse(meta.has("og:image:alt"));
    }),
  );

  it.effect("shows nothing of an event shown only to members", () =>
    Effect.gen(function* () {
      const id = yield* publishedEvent({
        title: "Secret launch",
        summary: "Only for us.",
        cover,
        public: false,
      });
      assert.isTrue(Option.isNone(yield* Sharing.sharedEvent(id)));
    }),
  );

  it.effect("shows nothing of an event that is gone", () =>
    Effect.gen(function* () {
      const deleted = yield* publishedEvent({ deleted: true });
      assert.isTrue(Option.isNone(yield* Sharing.sharedEvent(deleted)));
      // Never published: no row. Not an id: not looked up.
      for (const id of [crypto.randomUUID(), "not-a-uuid", ""]) {
        assert.isTrue(Option.isNone(yield* Sharing.sharedEvent(id)), id);
      }
    }),
  );

  it.effect("names only the site when there is no event", () =>
    Effect.sync(() => {
      const meta = metaOf(Sharing.sharingTags({ site, event: Option.none() }));
      assert.deepStrictEqual(Object.fromEntries(meta), {
        "og:site_name": "Skjera Test",
        "og:title": "Skjera Test",
      });
    }),
  );

  it.effect(
    "puts the tags right before the end of the head, changing nothing else",
    () =>
      Effect.sync(() => {
        // Whatever the tags say, `$&` and the like included.
        for (const title of ["Launch", "Cost $& $1 $$"]) {
          const tags = `<meta property="og:title" content="${title}">`;
          assert.strictEqual(
            Sharing.withSharing(index, tags),
            index.replace("</head>", () => `${tags}\n</head>`),
          );
        }
      }),
  );

  it.effect("answers an event's page with its tags", () =>
    Effect.gen(function* () {
      const id = yield* publishedEvent({
        title: "Launch",
        summary: "Coffee and a talk.",
        cover,
      });
      yield* withPages((page) =>
        Effect.gen(function* () {
          const response = yield* page(`/events/${id}`);
          assert.strictEqual(response.status, 200);
          assert.include(
            response.headers.get("content-type") ?? "",
            "text/html",
          );
          assert.strictEqual(response.headers.get("cache-control"), "no-cache");
          const html = yield* Effect.promise(() => response.text());
          const meta = metaOf(html);
          assert.strictEqual(meta.get("og:title"), "Launch");
          assert.strictEqual(meta.get("og:description"), "Coffee and a talk.");
          assert.strictEqual(meta.get("og:site_name"), siteName);
          assert.strictEqual(
            meta.get("og:url"),
            new URL(`/events/${id}`, siteUrl).href,
          );
          assert.strictEqual(
            meta.get("og:image"),
            new URL(cover.src, siteUrl).href,
          );
          // The built page, with the tags before the end of its head.
          const head = html.indexOf("</head>");
          assert.isAbove(head, 0);
          assert.strictEqual(html.replace(/<meta [^>]*>\n?/g, ""), index);
        }),
      );
    }),
  );

  it.effect(
    "answers a members-only event's page with the site's name only",
    () =>
      Effect.gen(function* () {
        const id = yield* publishedEvent({
          title: "Secret launch",
          summary: "Only for us.",
          cover,
          public: false,
        });
        yield* withPages((page) =>
          Effect.gen(function* () {
            const response = yield* page(`/events/${id}`);
            assert.strictEqual(response.status, 200);
            const html = yield* Effect.promise(() => response.text());
            for (const secret of [
              "Secret launch",
              "Only for us.",
              "AAAAAAAAAAAAAAAAAAAAAA",
            ]) {
              assert.notInclude(html, secret);
            }
            const meta = metaOf(html);
            assert.strictEqual(meta.get("og:title"), siteName);
            assert.strictEqual(meta.get("og:site_name"), siteName);
          }),
        );
      }),
  );

  it.effect(
    "answers a page that names no event with the site's name only",
    () =>
      Effect.gen(function* () {
        const deleted = yield* publishedEvent({ title: "Gone", deleted: true });
        yield* withPages((page) =>
          Effect.gen(function* () {
            for (const id of [deleted, crypto.randomUUID(), "not-a-uuid"]) {
              const response = yield* page(`/events/${id}`);
              assert.strictEqual(response.status, 200, id);
              const html = yield* Effect.promise(() => response.text());
              assert.notInclude(html, "Gone");
              assert.strictEqual(metaOf(html).get("og:title"), siteName, id);
            }
          }),
        );
      }),
  );

  it.effect("leaves the app's other pages to its fallback", () =>
    Effect.gen(function* () {
      yield* withPages((page) =>
        Effect.gen(function* () {
          const response = yield* page("/");
          assert.strictEqual(response.status, 200);
          assert.strictEqual(
            yield* Effect.promise(() => response.text()),
            index,
          );
        }),
      );
    }),
  );
});
