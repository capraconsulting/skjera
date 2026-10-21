// The Skjera backend: login, the HTTP API, table sync, the WebSocket
// drafts sync over, and images.
// Stateless: sessions and documents live in Postgres, images in S3, so any number of
// instances can run side by side.
import { createServer } from "node:http";
import { NodeCrypto, NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import * as Documents from "@skjera/documents";
import * as Email from "@skjera/email";
import * as OAuth from "@skjera/oauth";
import { Config, Effect, Layer, Option } from "effect";
import {
  FetchHttpClient,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/http-api";
import { KeyValueStore } from "effect/persistence";
import { Health } from "./health.ts";

class Api extends HttpApi.make("skjera")
  .add(
    HttpApiGroup.make("session")
      .add(HttpApiEndpoint.get("me", "/api/me", { success: OAuth.Identity }))
      .middleware(OAuth.Authentication),
  )
  // Public: no middleware, published content only.
  .add(Documents.EventsApi)
  .add(Documents.AttendeesApi)
  .add(Documents.SyncApi)
  .add(Documents.PublicSyncApi)
  .add(Documents.TeamsApi)
  .add(Documents.DocumentsApi) {}

const ApiHandlers = HttpApiBuilder.group(Api, "session", (handlers) =>
  handlers.handle("me", () =>
    Effect.gen(function* () {
      return yield* OAuth.CurrentUser;
    }),
  ),
);

const EventsHandlers = HttpApiBuilder.group(Api, "events", (handlers) =>
  Effect.gen(function* () {
    const attendance = yield* Documents.Attendance;
    const authenticator = yield* OAuth.Authenticator;

    // These endpoints are open to anyone; a session shows members-only
    // events and signs up as a member.
    const currentUser = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return yield* authenticator.fromCookies(request.cookies);
    });
    const signedIn = Effect.flatMap(currentUser, (user) =>
      Option.match(user, {
        onNone: () =>
          Effect.fail(
            new Documents.SignInRequired(
              Documents.refused({ _tag: "LogInToAttend" }),
            ),
          ),
        onSome: Effect.succeed,
      }),
    );

    return handlers
      .handle("attend", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* currentUser;
          if (Option.isSome(user)) {
            yield* attendance.attend(params.id, user.value, payload);
            return null;
          }
          if (payload.guest === undefined) {
            return yield* new Documents.SignInRequired(
              Documents.refused({ _tag: "LogInOrGuest" }),
            );
          }
          const cancelToken = yield* attendance.attendAsGuest(
            params.id,
            payload.guest,
            payload,
          );
          return new Documents.GuestSignup({ cancelToken });
        }),
      )
      .handle("leave", ({ params }) =>
        Effect.flatMap(signedIn, (user) => attendance.leave(params.id, user)),
      )
      .handle("leaveAsGuest", ({ params }) =>
        attendance.leaveAsGuest(params.id, params.token),
      )
      .handle("guestSignup", ({ params }) =>
        attendance.guestSignup(params.id, params.token),
      )
      .handle("change", ({ params, payload }) =>
        Effect.flatMap(signedIn, (user) =>
          attendance.change(params.id, { user }, payload),
        ),
      )
      .handle("changeAsGuest", ({ params, payload }) =>
        attendance.change(params.id, { cancelToken: params.token }, payload),
      );
  }),
);

const AttendeesHandlers = HttpApiBuilder.group(Api, "attendees", (handlers) =>
  Effect.gen(function* () {
    const attendance = yield* Documents.Attendance;
    return handlers
      .handle("remove", ({ params }) => attendance.remove(params.id))
      .handle("dietaryPreferences", ({ params }) =>
        attendance.dietaryPreferences(params.id),
      );
  }),
);

const SyncHandlers = HttpApiBuilder.group(Api, "sync", (handlers) =>
  Effect.gen(function* () {
    const sync = yield* Documents.Sync;
    return handlers
      .handle("teams", ({ query }) => sync.teams(query.since))
      .handle("documents", ({ query }) => sync.documents(query.since))
      .handle("tags", ({ query }) => sync.tags(query.since));
  }),
);

/** Who is looking at the site: a signed-in member, if anyone. */
const viewer = Effect.gen(function* () {
  const authenticator = yield* OAuth.Authenticator;
  const request = yield* HttpServerRequest.HttpServerRequest;
  return yield* authenticator.fromCookies(request.cookies);
});
const audience = Effect.map(viewer, (user) =>
  Option.isSome(user) ? ("members" as const) : ("anyone" as const),
);

const PublicSyncHandlers = HttpApiBuilder.group(Api, "publicSync", (handlers) =>
  Effect.gen(function* () {
    const sync = yield* Documents.Sync;
    return handlers
      .handle("events", ({ query }) =>
        Effect.flatMap(audience, (who) => sync.events(query.since, who)),
      )
      .handle("attendees", ({ query }) =>
        Effect.flatMap(viewer, (who) => sync.attendees(query.since, who)),
      );
  }),
);

const TeamsHandlers = HttpApiBuilder.group(Api, "teams", (handlers) =>
  Effect.gen(function* () {
    const teams = yield* Documents.Teams;
    return handlers
      .handle("create", ({ payload }) =>
        Effect.gen(function* () {
          return yield* teams.create(
            payload.name,
            yield* OAuth.CurrentUser,
            payload.id,
          );
        }),
      )
      .handle("rename", ({ params, payload }) =>
        teams.rename(params.id, payload.name),
      )
      .handle("setLogos", ({ params, payload }) =>
        teams.setLogos(params.id, payload),
      )
      .handle("delete", ({ params }) => teams.delete(params.id));
  }),
);

const DocumentsHandlers = HttpApiBuilder.group(Api, "documents", (handlers) =>
  Effect.gen(function* () {
    const documents = yield* Documents.Documents;
    return handlers
      .handle("create", ({ payload }) =>
        Effect.gen(function* () {
          return yield* documents.create(
            payload.type,
            payload.teamId,
            yield* OAuth.CurrentUser,
            payload.id,
          );
        }),
      )
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* () {
          return yield* documents.publish(
            params.id,
            payload.heads,
            yield* OAuth.CurrentUser,
          );
        }),
      )
      .handle("delete", ({ params }) =>
        Effect.gen(function* () {
          return yield* documents.delete(params.id, yield* OAuth.CurrentUser);
        }),
      );
  }),
);

/**
 * The built app (packages/app) from `STATIC_DIR`, in production; Vite
 * serves it in development. Paths that aren't files are the app's, which
 * it routes in the browser.
 */
const App = Layer.unwrap(
  Effect.gen(function* () {
    const root = yield* Config.option(Config.String("STATIC_DIR"));
    if (Option.isNone(root)) return Layer.empty;
    return Layer.mergeAll(
      // Named by their content, so they never change.
      HttpStaticServer.layer({
        root: `${root.value}/assets`,
        prefix: "/assets",
        cacheControl: "public, max-age=31536000, immutable",
      }),
      // An event's page, with what a shared link shows.
      Documents.Sharing.layerHttp({ index: `${root.value}/index.html` }),
      HttpStaticServer.layer({
        root: root.value,
        spa: true,
        cacheControl: "no-cache",
      }),
    );
  }),
);

/**
 * The site's own files, e.g. its logo, from `SITE_ASSETS_DIR`: so they can be
 * mounted beside the image (a ConfigMap) instead of hosted elsewhere.
 */
const SiteAssets = Layer.unwrap(
  Effect.gen(function* () {
    const root = yield* Config.option(Config.String("SITE_ASSETS_DIR"));
    return Option.isNone(root)
      ? Layer.empty
      : HttpStaticServer.layer({
          root: root.value,
          prefix: "/site-assets",
          cacheControl: "public, max-age=300",
        });
  }),
);

/** The site's name, language, logo, footer and privacy, for the app. */
const site = Layer.unwrap(
  Effect.map(Documents.SiteConfig, (config) =>
    HttpRouter.add(
      "GET",
      "/api/site",
      HttpServerResponse.json(Documents.Site.make(config)),
    ),
  ),
);

const Routes = Layer.mergeAll(
  HttpApiBuilder.layer(Api).pipe(
    Layer.provide([
      ApiHandlers,
      EventsHandlers,
      AttendeesHandlers,
      SyncHandlers,
      PublicSyncHandlers,
      TeamsHandlers,
      DocumentsHandlers,
    ]),
  ),
  Documents.DraftSync.layerHttp({ path: Documents.draftSyncPath }),
  Documents.Images.layerHttp,
  // The next events, for the websites to show in an iframe.
  Documents.Embed.layerHttp,
  // The coming events as JSON, in Skjer's format, for the websites.
  Documents.PublicEvents.layerHttp,
  // The coming events as a calendar to subscribe to, members only ones too.
  Documents.CalendarFeed.layerHttp,
  Health,
  site,
  SiteAssets,
  App,
).pipe(Layer.provideMerge(OAuth.routes));

const Server = Layer.unwrap(
  Effect.gen(function* () {
    const port = yield* Config.Port("PORT").pipe(Config.withDefault(3000));
    // Unset: every interface.
    const host = yield* Config.option(Config.String("HOST"));
    return NodeHttpServer.layer(
      createServer,
      Option.isNone(host) ? { port } : { port, host: host.value },
    );
  }),
);

// Services are built first (database, migrations, provider discovery): the
// HTTP server accepts connections as soon as it exists, and requests that
// arrive before the routes are served would get no response.
HttpRouter.serve(Routes).pipe(
  Layer.provide(Server),
  Layer.provide(OAuth.services),
  Layer.provide([
    FetchHttpClient.layer,
    KeyValueStore.layerSql({ table: "oauth_sessions" }),
  ]),
  Layer.provideMerge(Documents.layer),
  Layer.provide(NodeCrypto.layer),
  // SES, or SMTP (Mailpit in development): see EMAIL_TRANSPORT.
  Layer.provide(Email.layerConfig),
  Layer.provide(Documents.Images.Images.layer),
  Layer.launch,
  NodeRuntime.runMain,
);
