import { Config, Effect, FileSystem, Layer, Option, Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { SqlClient } from "effect/sql";
import { type Cover, DocumentId, SiteConfig } from "./Model.ts";

// What a link to an event shows when it is shared: LinkedIn, Slack and the
// like fetch the page without logging in and without running its scripts,
// so the server puts the event's title, summary and cover in the page's
// head. Only for events shown to everyone: the page of any other says the
// site's name and nothing of the event.

/** An event as a shared link may show it. */
export interface SharedEvent {
  readonly id: string;
  readonly title: string;
  /** Null: none. */
  readonly summary: string | null;
  /** Null: none. */
  readonly cover: Cover | null;
}

/** Where the site is, as a shared link names it. Without `url`: not known. */
export interface Site {
  readonly name: string;
  readonly url?: string;
}

const isDocumentId = Schema.is(DocumentId);

/**
 * The event a link to `/events/:id` may show: published, shown to everyone
 * (the condition `Sync.events` gives visitors) and not deleted. None
 * otherwise, and for anything that is not an event's id.
 */
export const sharedEvent = (id: string) =>
  Effect.gen(function* () {
    if (!isDocumentId(id)) return Option.none<SharedEvent>();
    const sql = yield* SqlClient.SqlClient;
    const [event] = yield* sql<{
      readonly title: string;
      readonly summary: string | null;
      readonly cover: Cover | null;
    }>`
      SELECT title, summary, cover FROM events
      WHERE id = ${id} AND is_public AND deleted_at IS NULL
    `;
    return Option.fromNullishOr(event).pipe(Option.map((e) => ({ id, ...e })));
  }).pipe(Effect.orDie);

const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const meta = (key: "name" | "property", name: string, content: string) =>
  `<meta ${key}="${name}" content="${escapeHtml(content)}">`;

/**
 * The tags for a link to the event, as HTML, every value escaped: its title
 * and, if it has them, summary and cover. With none, only the site's name.
 * The address and the image are full addresses, so they need `site.url`.
 */
export const sharingTags = (options: {
  readonly site: Site;
  readonly event: Option.Option<SharedEvent>;
}): string => {
  const { site, event } = options;
  const at = (path: string) =>
    site.url === undefined ? undefined : new URL(path, site.url).href;
  const tags = [meta("property", "og:site_name", site.name)];
  if (Option.isNone(event)) {
    tags.push(meta("property", "og:title", site.name));
    return tags.join("\n");
  }
  const { id, title, summary, cover } = event.value;
  const url = at(`/events/${id}`);
  const image = cover === null ? undefined : at(cover.src);
  tags.push(meta("property", "og:type", "website"));
  tags.push(meta("property", "og:title", title));
  if (summary !== null) {
    tags.push(meta("name", "description", summary));
    tags.push(meta("property", "og:description", summary));
  }
  if (url !== undefined) tags.push(meta("property", "og:url", url));
  if (cover !== null && image !== undefined) {
    tags.push(meta("property", "og:image", image));
    if (cover.alt.trim() !== "") {
      tags.push(meta("property", "og:image:alt", cover.alt));
    }
  }
  tags.push(
    meta(
      "name",
      "twitter:card",
      image === undefined ? "summary" : "summary_large_image",
    ),
  );
  return tags.join("\n");
};

/** The page with the tags right before the end of its head. */
export const withSharing = (page: string, tags: string): string =>
  // A function: the tags are text, not a pattern with `$&` in it.
  page.replace("</head>", () => `${tags}\n</head>`);

/**
 * `GET /events/:id`: the built page at `index` with what a link to the
 * event shows. An id with no event shown to everyone gets the page too,
 * with the site's name only: the app says in the browser that there is no
 * such event. Reads `index` when it starts, so a server without it fails
 * then rather than serving event pages without the app.
 */
export const layerHttp = (options: { readonly index: string }) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const sql = yield* SqlClient.SqlClient;
      const page = yield* fs.readFileString(options.index);
      const { name } = yield* SiteConfig;
      const url = Option.getOrUndefined(
        yield* Config.option(Config.String("SITE_URL")),
      );
      const site: Site = url === undefined ? { name } : { name, url };

      return HttpRouter.add(
        "GET",
        "/events/:id",
        Effect.gen(function* () {
          const { id } = yield* HttpRouter.params;
          const event = yield* sharedEvent(id ?? "").pipe(
            Effect.provideService(SqlClient.SqlClient, sql),
          );
          return HttpServerResponse.text(
            withSharing(page, sharingTags({ site, event })),
            {
              contentType: "text/html; charset=utf-8",
              headers: { "Cache-Control": "no-cache" },
            },
          );
        }),
      );
    }),
  );
