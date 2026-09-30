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
  .add(Documents.EventsApi) {}

const ApiHandlers = HttpApiBuilder.group(Api, "session", (handlers) =>
  handlers.handle("me", () =>
    Effect.gen(function* () {
      return yield* OAuth.CurrentUser;
    }),
  ),
);

const EventsHandlers = HttpApiBuilder.group(Api, "events", (handlers) =>
  Effect.gen(function* () {
    const events = yield* Documents.PublishedEvents;
    const attendance = yield* Documents.Attendance;
    const authenticator = yield* OAuth.Authenticator;

    // These endpoints are open to anyone; a session shows members-only
    // events and signs up as a member.
    const currentUser = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return yield* authenticator.fromCookies(request.cookies);
    });
    const audience = Effect.map(currentUser, (user) =>
      Option.isSome(user) ? ("members" as const) : ("anyone" as const),
    );
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
      .handle("list", () => Effect.flatMap(audience, events.list))
      .handle("get", ({ params }) =>
        Effect.flatMap(audience, (who) => events.get(params.id, who)),
      )
      .handle("attendance", ({ params }) =>
        Effect.flatMap(currentUser, (user) =>
          attendance.summary(params.id, user),
        ),
      )
      .handle("attend", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* currentUser;
          if (Option.isSome(user)) {
            yield* attendance.attend(params.id, user.value);
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

const Routes = Layer.mergeAll(
  HttpApiBuilder.layer(Api).pipe(Layer.provide([ApiHandlers, EventsHandlers])),
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
