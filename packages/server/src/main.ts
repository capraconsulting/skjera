// The Skjera backend: login, the session API and the documents WebSocket.
// Stateless: sessions and documents live in Postgres, so any number of
// instances can run side by side.
import { createServer } from "node:http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import * as Documents from "@skjera/documents";
import * as OAuth from "@skjera/oauth";
import { Config, Effect, Layer, Option } from "effect";
import {
  FetchHttpClient,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/http-api";
import { KeyValueStore } from "effect/persistence";

class Api extends HttpApi.make("skjera")
  .add(
    HttpApiGroup.make("session")
      .add(HttpApiEndpoint.get("me", "/api/me", { success: OAuth.Identity }))
      .middleware(OAuth.Authentication),
  )
  // Public: no middleware, published content only.
  .add(Documents.EventsApi)
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
            new Documents.SignInRequired({ message: "Log in to attend" }),
          ),
        onSome: Effect.succeed,
      }),
    );

    return handlers
      .handle("attend", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* currentUser;
          if (Option.isSome(user)) {
            yield* attendance.attend(
              params.id,
              user.value,
              payload.dietary,
              payload.id,
            );
            return null;
          }
          if (payload.guest === undefined) {
            return yield* new Documents.SignInRequired({
              message: "Log in, or leave your name and email",
            });
          }
          const cancelToken = yield* attendance.attendAsGuest(
            params.id,
            payload.guest,
            payload.dietary,
            payload.id,
          );
          return new Documents.GuestSignup({ cancelToken });
        }),
      )
      .handle("leave", ({ params }) =>
        Effect.flatMap(signedIn, (user) => attendance.leave(params.id, user)),
      )
      .handle("leaveAsGuest", ({ params }) =>
        attendance.leaveAsGuest(params.id, params.token),
      );
  }),
);

const SyncHandlers = HttpApiBuilder.group(Api, "sync", (handlers) =>
  Effect.gen(function* () {
    const sync = yield* Documents.Sync;
    return handlers
      .handle("teams", ({ query }) => sync.teams(query.since))
      .handle("documents", ({ query }) => sync.documents(query.since));
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
      .handle("delete", ({ params }) => documents.delete(params.id));
  }),
);

const Routes = Layer.mergeAll(
  HttpApiBuilder.layer(Api).pipe(
    Layer.provide([
      ApiHandlers,
      EventsHandlers,
      SyncHandlers,
      PublicSyncHandlers,
      TeamsHandlers,
      DocumentsHandlers,
    ]),
  ),
  Documents.RpcServer.layerHttp({ path: "/rpc" }),
  HttpRouter.add("GET", "/health", HttpServerResponse.text("ok")),
).pipe(Layer.provideMerge(OAuth.routes));

const Server = Layer.unwrap(
  Effect.gen(function* () {
    const port = yield* Config.Port("PORT").pipe(Config.withDefault(3000));
    return NodeHttpServer.layer(createServer, { port });
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
  Layer.launch,
  NodeRuntime.runMain,
);
