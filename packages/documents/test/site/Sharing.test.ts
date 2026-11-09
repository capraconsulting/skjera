import {
  NodeFileSystem,
  NodeHttpPlatform,
  NodeServices,
} from "@effect/platform-node";
import { assert, layer } from "@effect/vitest";
import { Identity } from "@skjera/oauth/api";
import { ConfigProvider, Effect, FileSystem, Layer, Option } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { SqlClient } from "effect/sql";
import { Documents } from "../../src/events/documents/index.ts";
import { Images } from "../../src/events/images/index.ts";
import { type Cover, type DocumentId, SiteSettings } from "../../src/Model.ts";
import { Announcements } from "../../src/notices/Announcements.ts";
import { Notifications } from "../../src/notices/Notifications.ts";
import { SalesEvents } from "../../src/notices/SalesEvents.ts";
import * as Sharing from "../../src/site/Sharing.ts";
import { Teams } from "../../src/Teams.ts";
import { TestDatabase } from "../TestDatabase.ts";

// What a link to an event shows: which event it may show, the tags that say
// so, and the page the server answers with. (SITE_URL and SITE_NAME as in
// mise.toml.)

const alice = new Identity({ issuer: "https://idp.example", subject: "alice" });

const TestLayer = Layer.mergeAll(Teams.layer, Documents.layer).pipe(
  Layer.provideMerge(Announcements.layerTest),
  Layer.provideMerge(SalesEvents.layerTest),
  Layer.provideMerge(Notifications.layerTest),
  Layer.provideMerge(TestDatabase),
);

const siteUrl = process.env.SITE_URL ?? "";
const siteName = process.env.SITE_NAME ?? "Skjera";
const site = { name: "Skjera Test", url: "https://skjera.test" };
const fullSite = {
  ...site,
  description: "Skjer | Capra Liflig",
  twitter: "@capraconsulting",
  author: "Capra Consulting",
  publisher: "Capra Publishing",
};

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

/** The link tags of a page's head: rel to href. */
const linksOf = (html: string) =>
  new Map(
    [...html.matchAll(/<link\s+rel="([^"]*)"\s+href="([^"]*)"\s*\/?>/g)].map(
      (match) => [match[1] ?? "", match[2] ?? ""],
    ),
  );

/** An image with a PNG's signature and header, so it is stored and its size is read. */
const pngOf = (width: number, height: number) => {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
};

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

const appScript = "console.log('the app');\n";

/**
 * Serves the built app in a temporary directory (`index`, and `app.js` beside
 * it) through `Sharing.layerHttp({ root })`, on the test database, with the
 * object storage for covers. `settings` are laid over the environment, where a
 * blank value means not set. `use` fetches pages from it; a request asks for
 * HTML unless it says otherwise.
 */
const withPages = <A, E, R>(
  settings: Record<string, string>,
  use: (
    page: (
      path: string,
      headers?: Record<string, string>,
    ) => Effect.Effect<Response>,
  ) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    yield* fs.writeFileString(`${root}/index.html`, index);
    yield* fs.writeFileString(`${root}/app.js`, appScript);
    const sql = yield* SqlClient.SqlClient;
    const app = Sharing.layerHttp({ root }).pipe(
      Layer.provide(Layer.succeed(SqlClient.SqlClient, sql)),
      Layer.provide(SiteSettings.layer),
      Layer.provide(
        // The environment with the settings over it: a blank one is not set.
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ ...process.env, ...settings }),
        ),
      ),
      Layer.provide(NodeServices.layer),
      Layer.provide(NodeHttpPlatform.layer),
      // Outside the override, so the S3 settings still reach it.
      Layer.provide(Images.layer),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(app, {
      disableLogger: true,
    });
    yield* Effect.addFinalizer(() => Effect.promise(dispose));
    return yield* use((path, headers = { accept: "text/html" }) =>
      Effect.promise(() =>
        handler(new Request(`http://localhost${path}`, { headers })),
      ),
    );
  }).pipe(Effect.provide(NodeFileSystem.layer), Effect.scoped);

/** The page's head without the tags the server put in it. */
const asBuilt = (html: string) => html.replace(/<(?:meta|link) [^>]*>\n?/g, "");

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Sharing", (it) => {
  it.effect(
    "serves a login failure with site tags and escaped failure tags (AC-3, AC-4)",
    () =>
      Effect.gen(function* () {
        const failure = {
          kind: "failed" as const,
          returnTo: `/events/launch?x=" /><script>alert(1)</script>`,
        };
        const response = HttpServerResponse.toWeb(
          yield* Sharing.loginFailurePage(
            index,
            fullSite,
            failure,
            "/oauth/callback",
          ),
        );
        assert.strictEqual(response.headers.get("cache-control"), "no-cache");
        const html = yield* Effect.promise(() => response.text());
        assert.strictEqual(
          metaOf(html).get("description"),
          "Skjer | Capra Liflig",
        );
        assert.notInclude(html, "<script>alert(1)</script>");
        assert.strictEqual(
          readEscaped(metaOf(html).get("skjera-login-failure") ?? ""),
          failure.kind,
        );
        assert.strictEqual(
          readEscaped(metaOf(html).get("skjera-login-return-to") ?? ""),
          failure.returnTo,
        );
      }),
  );

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

  it.effect(
    "shares an event shown only to members as one shown to everyone",
    () =>
      Effect.gen(function* () {
        const id = yield* publishedEvent({
          title: "Members launch",
          summary: "Only for us.",
          cover,
          public: false,
        });
        const event = yield* Sharing.sharedEvent(id);
        const meta = metaOf(Sharing.sharingTags({ site, event }));
        assert.strictEqual(meta.get("og:title"), "Members launch");
        assert.strictEqual(meta.get("og:description"), "Only for us.");
        assert.strictEqual(
          meta.get("og:image"),
          "https://skjera.test/api/images/AAAAAAAAAAAAAAAAAAAAAA",
        );
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

  it.effect("adds the site's description when there is no event (AC-6)", () =>
    Effect.sync(() => {
      const meta = metaOf(
        Sharing.sharingTags({ site: fullSite, event: Option.none() }),
      );
      assert.deepStrictEqual(Object.fromEntries(meta), {
        "og:site_name": "Skjera Test",
        "og:title": "Skjera Test",
        description: "Skjer | Capra Liflig",
      });
      assert.strictEqual(
        metaOf(Sharing.siteTags(fullSite)).get("description"),
        "Skjer | Capra Liflig",
      );
      assert.strictEqual(Sharing.siteTags(site), "");
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

  it.effect("answers an event's page with its tags (AC-3)", () =>
    Effect.gen(function* () {
      const id = yield* publishedEvent({
        title: "Launch",
        summary: "Coffee and a talk.",
        cover,
      });
      yield* withPages({}, (page) =>
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
          assert.strictEqual(asBuilt(html), index);
          assert.strictEqual(
            linksOf(html).get("canonical"),
            new URL(`/events/${id}`, siteUrl).href,
          );
        }),
      );
    }),
  );

  it.effect(
    "answers a page that names no event with the site's name only",
    () =>
      Effect.gen(function* () {
        const deleted = yield* publishedEvent({ title: "Gone", deleted: true });
        yield* withPages({}, (page) =>
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

  it.effect(
    "gives the canonical address, the cover's size and when it was first published (AC-3, AC-5)",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const id = yield* publishedEvent({ summary: "Coffee.", cover });
        const event = yield* Sharing.sharedEvent(id);
        const tags = Sharing.sharingTags({
          site,
          event,
          coverSize: { width: 1600, height: 900 },
        });
        const meta = metaOf(tags);
        assert.strictEqual(
          linksOf(tags).get("canonical"),
          `https://skjera.test/events/${id}`,
        );
        assert.strictEqual(linksOf(tags).get("canonical"), meta.get("og:url"));
        assert.strictEqual(meta.get("og:image:width"), "1600");
        assert.strictEqual(meta.get("og:image:height"), "900");
        const [row] = yield* sql<{ readonly first_published_at: Date }>`
          SELECT first_published_at FROM events WHERE id = ${id}
        `;
        assert.strictEqual(
          meta.get("article:published_time"),
          row?.first_published_at.toISOString(),
        );
      }).pipe(Effect.orDie),
  );

  it.effect(
    "leaves out the canonical address without SITE_URL, and the size without a cover or a size read (AC-3, AC-5)",
    () =>
      Effect.gen(function* () {
        const withCover = yield* Sharing.sharedEvent(
          yield* publishedEvent({ cover }),
        );
        const without = yield* Sharing.sharedEvent(yield* publishedEvent());
        const noUrl = Sharing.sharingTags({
          site: { name: "Skjera Test" },
          event: withCover,
          coverSize: { width: 1, height: 1 },
        });
        assert.isFalse(linksOf(noUrl).has("canonical"));
        const noSize = metaOf(Sharing.sharingTags({ site, event: withCover }));
        const noCover = metaOf(
          Sharing.sharingTags({
            site,
            event: without,
            coverSize: { width: 1, height: 1 },
          }),
        );
        for (const meta of [noSize, noCover]) {
          assert.isFalse(meta.has("og:image:width"));
          assert.isFalse(meta.has("og:image:height"));
        }
        assert.isTrue(noSize.has("article:published_time"));
      }),
  );

  it.effect(
    "gives the Twitter handle, author and publisher the site has, and only those (AC-4)",
    () =>
      Effect.gen(function* () {
        const event = yield* Sharing.sharedEvent(yield* publishedEvent());
        const all = metaOf(Sharing.sharingTags({ site: fullSite, event }));
        assert.strictEqual(all.get("twitter:site"), "@capraconsulting");
        assert.strictEqual(all.get("author"), "Capra Consulting");
        assert.strictEqual(all.get("publisher"), "Capra Publishing");

        const none = metaOf(Sharing.sharingTags({ site, event }));
        for (const key of ["twitter:site", "author", "publisher"]) {
          assert.isFalse(none.has(key), key);
        }
        const onlyAuthor = metaOf(
          Sharing.sharingTags({ site: { ...site, author: "Ada" }, event }),
        );
        assert.strictEqual(onlyAuthor.get("author"), "Ada");
        assert.isFalse(onlyAuthor.has("twitter:site"));
        assert.isFalse(onlyAuthor.has("publisher"));

        const nasty = `<b>"Ada" & co</b>`;
        const tags = Sharing.sharingTags({
          site: { ...site, author: nasty },
          event,
        });
        assert.notInclude(tags, "<b>");
        assert.strictEqual(
          readEscaped(metaOf(tags).get("author") ?? ""),
          nasty,
        );
      }),
  );

  it.effect(
    "gives the site's description to an event without a summary, and never two descriptions (AC-6)",
    () =>
      Effect.gen(function* () {
        const bare = yield* Sharing.sharedEvent(yield* publishedEvent());
        const bareTags = Sharing.sharingTags({ site: fullSite, event: bare });
        assert.strictEqual(
          metaOf(bareTags).get("description"),
          "Skjer | Capra Liflig",
        );
        assert.isFalse(metaOf(bareTags).has("og:description"));

        const told = yield* Sharing.sharedEvent(
          yield* publishedEvent({ summary: "Coffee and a talk." }),
        );
        const toldTags = Sharing.sharingTags({ site: fullSite, event: told });
        assert.strictEqual(
          metaOf(toldTags).get("description"),
          "Coffee and a talk.",
        );
        for (const tags of [bareTags, toldTags]) {
          assert.strictEqual(tags.match(/name="description"/g)?.length, 1);
        }
      }),
  );

  it.effect(
    "answers the Twitter handle, author and publisher from the settings (AC-4)",
    () =>
      Effect.gen(function* () {
        const id = yield* publishedEvent({ summary: "Coffee." });
        yield* withPages(
          {
            SITE_TWITTER: "@handle",
            SITE_AUTHOR: "An Author",
            SITE_PUBLISHER: "A Publisher",
          },
          (page) =>
            Effect.gen(function* () {
              const response = yield* page(`/events/${id}`);
              const meta = metaOf(yield* Effect.promise(() => response.text()));
              assert.strictEqual(meta.get("twitter:site"), "@handle");
              assert.strictEqual(meta.get("author"), "An Author");
              assert.strictEqual(meta.get("publisher"), "A Publisher");
            }),
        );
        yield* withPages(
          { SITE_TWITTER: "", SITE_AUTHOR: " ", SITE_PUBLISHER: "" },
          (page) =>
            Effect.gen(function* () {
              const response = yield* page(`/events/${id}`);
              const meta = metaOf(yield* Effect.promise(() => response.text()));
              for (const key of ["twitter:site", "author", "publisher"]) {
                assert.isFalse(meta.has(key), key);
              }
            }),
        );
      }),
  );

  it.effect(
    "shares the cover's cropped part, with that file's size, and the picture without a crop (AC-2, AC-4)",
    () =>
      Effect.gen(function* () {
        const images = yield* Images;
        const whole = yield* images.upload(pngOf(1600, 900));
        const half = yield* images.upload(pngOf(800, 900));
        const cropped = yield* publishedEvent({
          cover: {
            src: whole.url,
            alt: "",
            crop: {
              x: 0,
              y: 0,
              width: 0.5,
              height: 1,
              from: whole.url,
              src: half.url,
            },
          },
        });
        const uncropped = yield* publishedEvent({
          cover: { src: whole.url, alt: "" },
        });
        yield* withPages({}, (page) =>
          Effect.gen(function* () {
            const read = (id: string) =>
              Effect.gen(function* () {
                const response = yield* page(`/events/${id}`);
                return metaOf(yield* Effect.promise(() => response.text()));
              });
            const part = yield* read(cropped);
            assert.isTrue(part.get("og:image")?.endsWith(half.url));
            assert.strictEqual(part.get("og:image:width"), "800");
            assert.strictEqual(part.get("og:image:height"), "900");
            const picture = yield* read(uncropped);
            assert.isTrue(picture.get("og:image")?.endsWith(whole.url));
            assert.strictEqual(picture.get("og:image:width"), "1600");
          }),
        );
      }).pipe(Effect.provide(Images.layer)),
  );

  it.effect(
    "answers with the cover's own size, and without one when it cannot be read (AC-5)",
    () =>
      Effect.gen(function* () {
        const images = yield* Images;
        const readable = yield* images.upload(pngOf(1600, 900));
        // Stored as a PNG, but its header ends before the size.
        const unreadable = yield* images.upload(pngOf(1, 1).subarray(0, 12));
        const shown = yield* publishedEvent({
          cover: { src: readable.url, alt: "" },
        });
        const cut = yield* publishedEvent({
          cover: { src: unreadable.url, alt: "" },
        });
        const missing = yield* publishedEvent({ cover });
        yield* withPages({}, (page) =>
          Effect.gen(function* () {
            const read = (id: string) =>
              Effect.gen(function* () {
                const response = yield* page(`/events/${id}`);
                assert.strictEqual(response.status, 200);
                return metaOf(yield* Effect.promise(() => response.text()));
              });
            const meta = yield* read(shown);
            assert.strictEqual(meta.get("og:image:width"), "1600");
            assert.strictEqual(meta.get("og:image:height"), "900");
            // Fetched again: the size is the same.
            assert.strictEqual(
              (yield* read(shown)).get("og:image:width"),
              "1600",
            );
            for (const id of [cut, missing]) {
              const other = yield* read(id);
              assert.isTrue(other.has("og:image"), id);
              assert.isFalse(other.has("og:image:width"), id);
              assert.isFalse(other.has("og:image:height"), id);
            }
          }),
        );
      }).pipe(Effect.provide(Images.layer)),
  );

  it.effect(
    "answers the app's pages with the site's description, and its files as they are (AC-6)",
    () =>
      Effect.gen(function* () {
        yield* withPages({ SITE_DESCRIPTION: "Skjer | Capra Liflig" }, (page) =>
          Effect.gen(function* () {
            for (const path of ["/", "/privacy"]) {
              const response = yield* page(path);
              assert.strictEqual(response.status, 200, path);
              assert.include(
                response.headers.get("content-type") ?? "",
                "text/html",
              );
              assert.strictEqual(
                response.headers.get("cache-control"),
                "no-cache",
              );
              const html = yield* Effect.promise(() => response.text());
              assert.strictEqual(
                metaOf(html).get("description"),
                "Skjer | Capra Liflig",
                path,
              );
              assert.strictEqual(asBuilt(html), index, path);
            }
            const file = yield* page("/app.js");
            assert.strictEqual(file.status, 200);
            assert.strictEqual(
              yield* Effect.promise(() => file.text()),
              appScript,
            );
            assert.strictEqual((yield* page("/missing.js")).status, 404);
            const asked = yield* page("/privacy", {
              accept: "application/json",
            });
            assert.strictEqual(asked.status, 404);
          }),
        );
      }),
  );

  it.effect(
    "gives an unknown event's page and an event's page without a summary the site's description (AC-6)",
    () =>
      Effect.gen(function* () {
        const deleted = yield* publishedEvent({ deleted: true });
        const bare = yield* publishedEvent();
        const told = yield* publishedEvent({ summary: "Coffee and a talk." });
        yield* withPages({ SITE_DESCRIPTION: "Skjer | Capra Liflig" }, (page) =>
          Effect.gen(function* () {
            const descriptionOf = (id: string) =>
              Effect.gen(function* () {
                const response = yield* page(`/events/${id}`);
                const html = yield* Effect.promise(() => response.text());
                assert.strictEqual(
                  html.match(/name="description"/g)?.length,
                  1,
                );
                return metaOf(html).get("description");
              });
            for (const id of [deleted, bare, crypto.randomUUID()]) {
              assert.strictEqual(
                yield* descriptionOf(id),
                "Skjer | Capra Liflig",
                id,
              );
            }
            assert.strictEqual(
              yield* descriptionOf(told),
              "Coffee and a talk.",
            );
          }),
        );
      }),
  );

  it.effect(
    "answers the app's pages as built without SITE_DESCRIPTION (AC-6)",
    () =>
      Effect.gen(function* () {
        yield* withPages({ SITE_DESCRIPTION: "" }, (page) =>
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
