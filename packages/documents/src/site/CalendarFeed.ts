import { absoluteAppUrl, appPaths } from "@skjera/paths";
import { Clock, Config, Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { SqlClient } from "effect/sql";
import { optionalSetting, SiteConfig } from "../Model.ts";
import { type FeedEvent, feed } from "./Calendar.ts";

// The coming events as a calendar to subscribe to (`GET /api/subscribe`), as
// Skjer serves it: every published event that has not ended, those for
// members only too, to anyone with the address. Calendars such as Google's
// fetch it again now and then, so the events in them stay up to date.

/**
 * The published events that have not ended at `now`, soonest first, members
 * only ones too: one that has started and not ended is given. Each with its
 * page on the site at `siteUrl`.
 */
export const feedEvents = (now: Date, options: { readonly siteUrl: string }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{
      readonly id: string;
      readonly title: string;
      readonly starts_at: Date;
      readonly ends_at: Date;
      readonly place: string | null;
      readonly summary: string | null;
    }>`
      SELECT id, title, starts_at, ends_at, place, summary
      FROM events
      WHERE deleted_at IS NULL AND ends_at > ${now}
      ORDER BY starts_at, id
    `;
    return rows.map(
      (row): FeedEvent => ({
        id: row.id,
        title: row.title,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        url: absoluteAppUrl(options.siteUrl, appPaths.event(row.id)),
        ...(row.place === null ? {} : { place: row.place }),
        ...(row.summary === null ? {} : { summary: row.summary }),
      }),
    );
  }).pipe(Effect.orDie);

/**
 * `GET /api/subscribe`: the calendar of coming events, to anyone, named after
 * the site (`SITE_NAME`) and in the site's language. Reads the configuration
 * when it starts.
 * Without `SITE_URL`, with a warning, it serves nothing: an event is never
 * given without its page's full address.
 */
export const layerHttp = Layer.unwrap(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const { name, locale } = yield* SiteConfig;
    const siteUrl = yield* optionalSetting("SITE_URL", Config.String);
    if (siteUrl === undefined) {
      yield* Effect.logWarning("SITE_URL not set: /api/subscribe isn't served");
      return Layer.empty;
    }
    const site = { name, locale, host: new URL(siteUrl).host };

    return HttpRouter.add(
      "GET",
      appPaths.subscribe,
      Effect.gen(function* () {
        const now = new Date(yield* Clock.currentTimeMillis);
        const events = yield* feedEvents(now, { siteUrl }).pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
        );
        return HttpServerResponse.text(feed({ events, site }), {
          contentType: "text/calendar; charset=utf-8",
        });
      }),
    );
  }),
);
