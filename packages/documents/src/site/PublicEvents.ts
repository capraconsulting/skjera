import { absoluteAppUrl, appPaths } from "@skjera/paths";
import { Clock, Config, Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { SqlClient } from "effect/sql";
import { type Category, eventCategory, optionalSetting } from "../Model.ts";
import { WebsiteOrigins } from "./Embed.ts";

// The coming events as JSON (`GET /api/public/events`), in the format of
// Skjer's API, for the company's websites to read from the browser. Only the
// websites in `WEBSITE_ORIGINS` may read it.

/** An event as the API reads it, with the name of the team that organises it. */
export interface ComingEvent {
  readonly id: string;
  readonly title: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** Null: published before events had a place. */
  readonly place: string | null;
  /** Null: none. */
  readonly summary: string | null;
  readonly isStreamed: boolean;
  readonly allowGuests: boolean;
  readonly teamName: string;
  /** As the organiser wrote them. */
  readonly tags: ReadonlyArray<string>;
}

/**
 * The events shown to everyone that have not ended at `now`, soonest first,
 * all of them: the condition `Sync.events` gives visitors, with the team
 * joined as there. One that has started and not ended is listed.
 */
export const comingEvents = (now: Date) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{
      readonly id: string;
      readonly title: string;
      readonly starts_at: Date;
      readonly ends_at: Date;
      readonly place: string | null;
      readonly summary: string | null;
      readonly is_streamed: boolean;
      readonly allow_guests: boolean;
      readonly team_name: string;
      readonly tags: ReadonlyArray<string>;
    }>`
      SELECT e.id, e.title, e.starts_at, e.ends_at, e.place, e.summary,
        e.is_streamed, e.allow_guests, t.name AS team_name, e.tags
      FROM events e
        JOIN documents d ON d.id = e.id
        JOIN teams t ON t.id = d.team_id
      WHERE e.is_public AND e.deleted_at IS NULL AND e.ends_at > ${now}
      ORDER BY e.starts_at, e.id
    `;
    return rows.map(
      (row): ComingEvent => ({
        id: row.id,
        title: row.title,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        place: row.place,
        summary: row.summary,
        isStreamed: row.is_streamed,
        allowGuests: row.allow_guests,
        teamName: row.team_name,
        tags: row.tags,
      }),
    );
  }).pipe(Effect.orDie);

/** An event in Skjer's format, as the websites read it. */
export interface PublicEvent {
  readonly id: string;
  readonly title: string;
  /** ISO 8601, UTC: "2036-11-15T17:00:00.000Z". */
  readonly start: string;
  readonly end: string;
  readonly place: string;
  readonly summary: string | null;
  /** «Sosialt» or «Fag», from the event's tags; null: neither. */
  readonly category: Category | null;
  readonly organisers: string;
  readonly isDigital: boolean;
  readonly openForExternals: boolean;
  readonly url: string;
}

// The one place Skjera knows Skjer's organisers: the websites read the team
// of the whole company as "Alle".
const companyTeam = "Capra Gruppen";

/** The organisers Skjer gives for an event of the team called `teamName`. */
const organisers = (teamName: string): string =>
  teamName.toLowerCase() === companyTeam.toLowerCase() ? "Alle" : teamName;

/**
 * What the websites get of an event, with the names and types of Skjer's
 * answer. `siteUrl` is the site's address, for the event's full address.
 */
export const publicEvent = (
  event: ComingEvent,
  options: { readonly siteUrl: string },
): PublicEvent => ({
  id: event.id,
  title: event.title,
  start: event.startsAt.toISOString(),
  end: event.endsAt.toISOString(),
  // Skjer's place is always a string.
  place: event.place ?? "",
  summary: event.summary,
  category: eventCategory(event.tags),
  organisers: organisers(event.teamName),
  isDigital: event.isStreamed,
  openForExternals: event.allowGuests,
  url: absoluteAppUrl(options.siteUrl, appPaths.event(event.id)),
});

/**
 * The CORS headers for a request from `origin`: a website in `websites` may
 * read the answer in the browser, as Skjer lets it (credentials too: the
 * answer is the same for everyone), any other may not. The answer differs by
 * origin, so caches keep one per origin.
 */
export const corsHeaders = (
  origin: string | undefined,
  websites: ReadonlyArray<string>,
): Record<string, string> =>
  origin !== undefined && websites.includes(origin)
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        Vary: "Origin",
      }
    : { Vary: "Origin" };

// What Skjer's preflight lets through (`cors.ts` in Skjer), so a fetch that
// passes there passes here.
const allowedHeaders =
  "authorization, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version";

/**
 * `GET /api/public/events`: the coming events as JSON, readable in the
 * browser from the websites in `WEBSITE_ORIGINS` only, and `OPTIONS` for the
 * browser's preflight. Reads the configuration when it starts. Without
 * `SITE_URL`, with a warning, it serves nothing: an event is never given
 * without its full address.
 */
export const layerHttp = Layer.unwrap(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const websites = yield* WebsiteOrigins;
    const siteUrl = yield* optionalSetting("SITE_URL", Config.String);
    if (siteUrl === undefined) {
      yield* Effect.logWarning(
        "SITE_URL not set: /api/public/events isn't served",
      );
      return Layer.empty;
    }

    const originOf = Effect.map(
      HttpServerRequest.HttpServerRequest,
      (request) => request.headers.origin,
    );

    return Layer.mergeAll(
      HttpRouter.add(
        "GET",
        "/api/public/events",
        Effect.gen(function* () {
          const origin = yield* originOf;
          const now = new Date(yield* Clock.currentTimeMillis);
          const events = yield* comingEvents(now).pipe(
            Effect.provideService(SqlClient.SqlClient, sql),
          );
          return HttpServerResponse.jsonUnsafe(
            events.map((event) => publicEvent(event, { siteUrl })),
            {
              headers: {
                "Cache-Control": "public, max-age=300",
                ...corsHeaders(origin, websites),
              },
            },
          );
        }),
      ),
      HttpRouter.add(
        "OPTIONS",
        "/api/public/events",
        Effect.gen(function* () {
          const origin = yield* originOf;
          const cors = corsHeaders(origin, websites);
          return HttpServerResponse.empty({
            status: 204,
            headers:
              "Access-Control-Allow-Origin" in cors
                ? {
                    ...cors,
                    "Access-Control-Allow-Methods": "GET",
                    "Access-Control-Allow-Headers": allowedHeaders,
                  }
                : cors,
          });
        }),
      ),
    );
  }),
);
