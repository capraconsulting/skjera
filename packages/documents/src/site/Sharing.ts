import { appPaths, appPatterns } from "@skjera/paths";
import { Config, Effect, FileSystem, Layer, Option, Schema } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerRespondable,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/http";
import { SqlClient } from "effect/sql";
import { imagesPath } from "../api/ImagesApi.ts";
import { type ImageSize, Images, readImageSize } from "../events/Images.ts";
import {
  type Cover,
  DocumentId,
  optionalSetting,
  SiteSettings,
  shownCover,
} from "../Model.ts";

// What a link to an event shows when it is shared: LinkedIn, Slack and the
// like fetch the page without logging in and without running its scripts,
// so the server puts the event's title, summary and cover in the page's
// head. For any published event, members-only ones too: whoever has the
// address may see the event, as its page shows it. The page of an unknown,
// unpublished or deleted event says the site's name and nothing of an event.
// Search engines are told the same way: every page of the app has the site's
// description in its head, and an event's page its canonical address, when it
// was first published and who wrote it.

/** An event as a shared link may show it. */
export interface SharedEvent {
  readonly id: string;
  readonly title: string;
  /** Null: none. */
  readonly summary: string | null;
  /** Null: none. */
  readonly cover: Cover | null;
  /** When the event was first published. */
  readonly publishedAt: Date;
}

/**
 * Where the site is and what it says of itself, as the pages' heads name it.
 * Without a field: not known, and its tag is left out.
 */
export interface Site {
  readonly name: string;
  /** `SITE_URL`. */
  readonly url?: string;
  /** `SITE_DESCRIPTION`. */
  readonly description?: string;
  /** `SITE_TWITTER`, as written: "@capraconsulting". */
  readonly twitter?: string;
  /** `SITE_AUTHOR`. */
  readonly author?: string;
  /** `SITE_PUBLISHER`. */
  readonly publisher?: string;
}

/** The site, as the pages' heads name it: `SITE_NAME` and the settings of `Site`. */
export const SharingSite = Effect.gen(function* () {
  const { name, url, description } = yield* SiteSettings;
  const twitter = yield* optionalSetting("SITE_TWITTER", Config.String);
  const author = yield* optionalSetting("SITE_AUTHOR", Config.String);
  const publisher = yield* optionalSetting("SITE_PUBLISHER", Config.String);
  return {
    name,
    ...(url === undefined ? {} : { url }),
    ...(description === undefined ? {} : { description }),
    ...(twitter === undefined ? {} : { twitter }),
    ...(author === undefined ? {} : { author }),
    ...(publisher === undefined ? {} : { publisher }),
  } satisfies Site;
});

const isDocumentId = Schema.is(DocumentId);

/**
 * The event a link to `/events/:id` may show: published, whoever it is shown
 * to, and not deleted. None otherwise, and for anything that is not an
 * event's id.
 */
export const sharedEvent = (id: string) =>
  Effect.gen(function* () {
    if (!isDocumentId(id)) return Option.none<SharedEvent>();
    const sql = yield* SqlClient.SqlClient;
    const [event] = yield* sql<{
      readonly title: string;
      readonly summary: string | null;
      readonly cover: Cover | null;
      readonly first_published_at: Date;
    }>`
      SELECT title, summary, cover, first_published_at FROM events
      WHERE id = ${id} AND deleted_at IS NULL
    `;
    return Option.fromNullishOr(event).pipe(
      Option.map(
        (e): SharedEvent => ({
          id,
          title: e.title,
          summary: e.summary,
          cover: e.cover,
          publishedAt: e.first_published_at,
        }),
      ),
    );
  }).pipe(Effect.orDie);

/** Text as HTML: safe in an element's content and in a quoted attribute. */
export const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const meta = (key: "name" | "property", name: string, content: string) =>
  `<meta ${key}="${name}" content="${escapeHtml(content)}">`;

const link = (rel: string, href: string) =>
  `<link rel="${rel}" href="${escapeHtml(href)}">`;

/** What every page of the app says of the site: its description, if it has one. */
export const siteTags = (site: Site): string =>
  site.description === undefined
    ? ""
    : meta("name", "description", site.description);

/**
 * The tags for a link to the event, as HTML, every value escaped: its title
 * and, if it has them, summary, cover and who wrote it. With none, only the
 * site's name. The address and the image are full addresses, so they need
 * `site.url`. The cover's size is given when it could be read.
 */
export const sharingTags = (options: {
  readonly site: Site;
  readonly event: Option.Option<SharedEvent>;
  readonly coverSize?: ImageSize | undefined;
}): string => {
  const { site, event, coverSize } = options;
  const at = (path: string) =>
    site.url === undefined ? undefined : new URL(path, site.url).href;
  const tags = [meta("property", "og:site_name", site.name)];
  if (Option.isNone(event)) {
    tags.push(meta("property", "og:title", site.name));
    const description = siteTags(site);
    if (description !== "") tags.push(description);
    return tags.join("\n");
  }
  const { id, title, summary, cover, publishedAt } = event.value;
  const url = at(appPaths.event(id));
  const image = cover === null ? undefined : at(shownCover(cover).src);
  tags.push(meta("property", "og:type", "website"));
  tags.push(meta("property", "og:title", title));
  // The summary, else the site's: never two descriptions.
  const description = summary ?? site.description;
  if (description !== undefined) {
    tags.push(meta("name", "description", description));
  }
  if (summary !== null) tags.push(meta("property", "og:description", summary));
  if (url !== undefined) {
    tags.push(meta("property", "og:url", url));
    tags.push(link("canonical", url));
  }
  if (cover !== null && image !== undefined) {
    tags.push(meta("property", "og:image", image));
    if (coverSize !== undefined) {
      tags.push(meta("property", "og:image:width", String(coverSize.width)));
      tags.push(meta("property", "og:image:height", String(coverSize.height)));
    }
    if (cover.alt.trim() !== "") {
      tags.push(meta("property", "og:image:alt", cover.alt));
    }
  }
  tags.push(
    meta("property", "article:published_time", publishedAt.toISOString()),
  );
  tags.push(
    meta(
      "name",
      "twitter:card",
      image === undefined ? "summary" : "summary_large_image",
    ),
  );
  if (site.twitter !== undefined) {
    tags.push(meta("name", "twitter:site", site.twitter));
  }
  if (site.author !== undefined) tags.push(meta("name", "author", site.author));
  if (site.publisher !== undefined) {
    tags.push(meta("name", "publisher", site.publisher));
  }
  return tags.join("\n");
};

/** The page with the tags right before the end of its head. */
export const withSharing = (page: string, tags: string): string =>
  // A function: the tags are text, not a pattern with `$&` in it.
  page.replace("</head>", () => `${tags}\n</head>`);

/** Whether the request asks for an HTML page. */
const asksForHtml = (accept: string | undefined) =>
  accept?.toLowerCase().includes("text/html") === true;

/**
 * The built app in the directory `root`, with what search engines and shared
 * links are told:
 *
 * - `GET /events/:id`: the app's page with what a link to the event shows.
 *   An id with no published event gets the page too, with the site's name
 *   only: the app says in the browser that there is no such event.
 * - `GET /*`: the files of `root` as they are. A path with no file is a page
 *   of the app, which it routes in the browser: `/`, and any path without an
 *   extension that the request accepts HTML for. Its head has the site's
 *   description. Anything else is a 404.
 *
 * Reads `root/index.html` when it starts, so a server without it fails then
 * rather than serving pages without the app.
 */
export const layerHttp = (options: { readonly root: string }) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const sql = yield* SqlClient.SqlClient;
      const images = yield* Images;
      const page = yield* fs.readFileString(`${options.root}/index.html`);
      const site = yield* SharingSite;
      const files = yield* HttpStaticServer.make({
        root: options.root,
        index: undefined,
        cacheControl: "no-cache",
      });
      const tags = siteTags(site);
      const appPage = tags === "" ? page : withSharing(page, tags);
      const html = (body: string) =>
        HttpServerResponse.text(body, {
          contentType: "text/html; charset=utf-8",
          headers: { "Cache-Control": "no-cache" },
        });

      // An image's id is only ever used for one image, so a size found stays.
      const sizes = new Map<string, ImageSize>();
      /** The cover's size, or none: any failure, and a read over 2 seconds, gives none. */
      const coverSize = (cover: Cover | null) =>
        Effect.gen(function* () {
          const prefix = `${imagesPath}/`;
          if (cover === null) return undefined;
          const { src } = shownCover(cover);
          if (!src.startsWith(prefix)) return undefined;
          const id = src.slice(prefix.length);
          const known = sizes.get(id);
          if (known !== undefined) return known;
          const stored = yield* images.get(id);
          if (Option.isNone(stored)) return undefined;
          const size = yield* readImageSize(stored.value.body);
          if (size !== undefined) sizes.set(id, size);
          return size;
        }).pipe(
          Effect.timeoutOption(2000),
          Effect.map(Option.getOrUndefined),
          Effect.catchCause((cause) =>
            Effect.logWarning("Reading cover size failed", cause).pipe(
              Effect.as(undefined),
            ),
          ),
        );

      return Layer.mergeAll(
        HttpRouter.add(
          "GET",
          appPatterns.event,
          Effect.gen(function* () {
            const { id } = yield* HttpRouter.params;
            const event = yield* sharedEvent(id ?? "").pipe(
              Effect.provideService(SqlClient.SqlClient, sql),
            );
            const size = Option.isSome(event)
              ? yield* coverSize(event.value.cover)
              : undefined;
            return html(
              withSharing(page, sharingTags({ site, event, coverSize: size })),
            );
          }),
        ),
        HttpRouter.add(
          "GET",
          "/*",
          files.pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                const request = yield* HttpServerRequest.HttpServerRequest;
                const { pathname } = new URL(request.url, "http://localhost");
                const isPage =
                  pathname === "/" ||
                  (!/\.[^/.]+$/.test(pathname) &&
                    asksForHtml(request.headers.accept));
                return error.reason._tag === "RouteNotFound" && isPage
                  ? html(appPage)
                  : yield* HttpServerRespondable.toResponse(error);
              }),
            ),
          ),
        ),
      );
    }),
  );
