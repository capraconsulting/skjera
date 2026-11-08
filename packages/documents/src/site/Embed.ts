import { m } from "@skjera/i18n/messages";
import { appPaths } from "@skjera/paths";
import { Clock, Config, Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { SqlClient } from "effect/sql";
import { type Locale, organizerLogos, SiteSettings } from "../Model.ts";
import { escapeHtml } from "./Html.ts";

// The next events as a small page of its own, for the company's websites to
// show in an iframe (`GET /embed`): written by the server, so nothing but
// the list and the script that tells the iframe its height loads in the
// frame. Only the websites in `WEBSITE_ORIGINS` may frame it.

const splitList = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

/**
 * The origin of a website's address; none if it is anything more than a
 * bare `http:` or `https:` origin: a path, a query, a fragment, a user, or
 * a character a host name cannot have (a `;` would end the frame header's
 * directive).
 */
const originOf = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    const bare =
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.href === `${url.origin}/` &&
      /^[a-z0-9.-]+(:\d+)?$/i.test(url.host);
    return bare ? url.origin : undefined;
  } catch {
    return undefined;
  }
};

const OriginsText = Schema.String.check(
  Schema.makeFilter((text: string) => {
    const wrong = splitList(text).find(
      (value) => originOf(value) === undefined,
    );
    return (
      wrong === undefined ||
      `Expected addresses of websites, such as https://www.example.com, separated by spaces or commas; got ${JSON.stringify(wrong)}`
    );
  }),
);

/**
 * The websites that show Skjera's events, such as the company's own: their
 * origins, from `WEBSITE_ORIGINS` (separated by spaces or commas). They may
 * show `/embed` in an iframe and read `/api/public/events` from the browser.
 * A value that is not a bare origin fails.
 */
export const WebsiteOrigins: Config.Config<ReadonlyArray<string>> =
  Config.schema(OriginsText, "WEBSITE_ORIGINS").pipe(
    Config.withDefault(""),
    Config.map((text) =>
      splitList(text).flatMap((value) => originOf(value) ?? []),
    ),
  );

/** The `Content-Security-Policy` that lets only the websites frame a page. */
export const frameAncestors = (origins: ReadonlyArray<string>): string =>
  origins.length === 0
    ? "frame-ancestors 'none'"
    : `frame-ancestors ${origins.join(" ")}`;

/** An event as the list reads it, with the team that organises it. */
export interface NextEvent {
  readonly id: string;
  readonly title: string;
  readonly startsAt: Date;
  readonly timeZone: string;
  readonly team: {
    readonly name: string;
    readonly logo: string | null;
    readonly logoDark: string | null;
  };
}

const listed = 3;

/**
 * The events shown to everyone that have not ended at `now`, soonest first,
 * at most three. One that has started and not ended is listed.
 */
export const nextEvents = (now: Date) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{
      readonly id: string;
      readonly title: string;
      readonly starts_at: Date;
      readonly time_zone: string;
      readonly team_name: string;
      readonly team_logo: string | null;
      readonly team_logo_dark: string | null;
    }>`
      SELECT e.id, e.title, e.starts_at, e.time_zone,
        t.name AS team_name, t.logo AS team_logo, t.logo_dark AS team_logo_dark
      FROM events e
        JOIN documents d ON d.id = e.id
        JOIN teams t ON t.id = d.team_id
      WHERE event_visible(e, false) AND e.ends_at > ${now}
      ORDER BY e.starts_at, e.id
      LIMIT ${listed}
    `;
    return rows.map(
      (row): NextEvent => ({
        id: row.id,
        title: row.title,
        startsAt: row.starts_at,
        timeZone: row.time_zone,
        team: {
          name: row.team_name,
          logo: row.team_logo,
          logoDark: row.team_logo_dark,
        },
      }),
    );
  }).pipe(Effect.orDie);

/** What the page shows of one event. */
export interface EmbedItem {
  /** The event's page, a path on the page's own address. */
  readonly href: string;
  readonly title: string;
  /** When it starts, as the front page says it. */
  readonly when: string;
  /** The start as an ISO string. */
  readonly startsAt: string;
  /** The team: its logo for a light page, else none and its name shows. */
  readonly organizer: {
    readonly name: string;
    readonly logo: string | null;
  };
}

const dayIn = (at: Date, timeZone: string) =>
  at.toLocaleDateString("en-CA", { timeZone });

/**
 * What the page shows of an event, as the front page says it: "Today at
 * 18:00" when it starts today in its own time zone, else the day there.
 */
export const embedItem = (
  event: NextEvent,
  options: { readonly locale: Locale; readonly now: Date },
): EmbedItem => {
  const { locale, now } = options;
  const { startsAt, timeZone } = event;
  const when =
    dayIn(startsAt, timeZone) === dayIn(now, timeZone)
      ? m.site_today_at(
          {
            time: startsAt.toLocaleTimeString(locale, {
              hour: "numeric",
              minute: "2-digit",
              timeZone,
            }),
          },
          { locale },
        )
      : startsAt.toLocaleDateString(locale, {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone,
        });
  return {
    href: appPaths.event(event.id),
    title: event.title,
    when,
    startsAt: startsAt.toISOString(),
    // The page is light, so the dark logo is never the one shown.
    organizer: {
      name: event.team.name,
      logo: organizerLogos(event.team).light,
    },
  };
};

// The pinned file and its hash: a new version cannot run on this address
// unseen. `curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A`.
const resizer = {
  src: "https://cdn.jsdelivr.net/npm/@open-iframe-resizer/core@2.4.1/dist/index.js",
  integrity:
    "sha384-COwwin4uVrndCbuZgQ/sdXjQdt6ykhFTWQ6Az1uvGDZguBBqm9O1hW1zjbIVbm5e",
};

const styles = `
html { color-scheme: light; }
body { margin: 0; background: #fff; color: #18181b; font-family: system-ui, sans-serif; }
ul { list-style: none; margin: 0; padding: 0; }
li + li { margin-top: 0.5rem; }
a { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 1rem; padding: 0.75rem 1rem; border: 1px solid #e4e4e7; border-radius: 0.5rem; color: inherit; text-decoration: none; }
a:hover { border-color: #a1a1aa; }
.title { flex: 1 1 14rem; font-size: 1.25rem; font-weight: 300; overflow-wrap: anywhere; }
time { color: #52525b; font-size: 0.875rem; }
.organizer { font-size: 0.875rem; color: #52525b; }
.organizer img { display: block; height: 1.5rem; width: auto; }
`;

const itemHtml = (item: EmbedItem) => {
  const organizer =
    item.organizer.logo === null
      ? escapeHtml(item.organizer.name)
      : `<img src="${escapeHtml(item.organizer.logo)}" alt="${escapeHtml(item.organizer.name)}">`;
  return `<li><a href="${escapeHtml(item.href)}" target="_blank"><span class="title">${escapeHtml(item.title)}</span> <time datetime="${escapeHtml(item.startsAt)}">${escapeHtml(item.when)}</time> <span class="organizer">${organizer}</span></a></li>`;
};

/**
 * The embed page, every text escaped. With no items the list is empty and
 * nothing else shows: the websites put their own heading around the iframe.
 */
export const embedPage = (options: {
  readonly site: { readonly name: string; readonly locale: Locale };
  readonly items: ReadonlyArray<EmbedItem>;
}): string => {
  const { site, items } = options;
  return `<!doctype html>
<html lang="${escapeHtml(site.locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(site.name)}</title>
<style>${styles}</style>
<script type="module" src="${resizer.src}" integrity="${resizer.integrity}" crossorigin="anonymous"></script>
</head>
<body>
<ul aria-label="${escapeHtml(m.site_upcoming({}, { locale: site.locale }))}">
${items.map(itemHtml).join("\n")}
</ul>
</body>
</html>
`;
};

/**
 * `GET /embed`: the page with the next events, in the site's language
 * (`SITE_LOCALE`: the websites' visitors have not picked one here), allowed
 * in an iframe on the websites in `WEBSITE_ORIGINS` only. Reads the
 * configuration when it starts, so a wrong `WEBSITE_ORIGINS` stops the
 * server then.
 */
export const layerHttp = Layer.unwrap(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const site = yield* SiteSettings;
    const policy = frameAncestors(yield* WebsiteOrigins);

    return HttpRouter.add(
      "GET",
      "/embed",
      Effect.gen(function* () {
        const now = new Date(yield* Clock.currentTimeMillis);
        const events = yield* nextEvents(now).pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
        );
        const items = events.map((event) =>
          embedItem(event, { locale: site.locale, now }),
        );
        return HttpServerResponse.text(embedPage({ site, items }), {
          contentType: "text/html; charset=utf-8",
          headers: {
            "Cache-Control": "no-cache",
            "Content-Security-Policy": policy,
          },
        });
      }),
    );
  }),
);
