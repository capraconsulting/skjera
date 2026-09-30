// The Skjera backend: login, the session API and the documents WebSocket.
// Stateless: sessions and documents live in Postgres, so any number of
// instances can run side by side.
import { createServer } from "node:http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import * as Documents from "@skjera/documents";
import * as OAuth from "@skjera/oauth";
import { Config, Effect, Layer } from "effect";
import { FetchHttpClient, HttpRouter, HttpServerResponse } from "effect/http";
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
  .add(Documents.PostsApi) {}

const ApiHandlers = HttpApiBuilder.group(Api, "session", (handlers) =>
  handlers.handle("me", () =>
    Effect.gen(function* () {
      return yield* OAuth.CurrentUser;
    }),
  ),
);

const PostsHandlers = HttpApiBuilder.group(Api, "posts", (handlers) =>
  Effect.gen(function* () {
    const posts = yield* Documents.PublishedPosts;
    return handlers
      .handle("list", () => posts.list)
      .handle("get", ({ params }) => posts.get(params.id));
  }),
);

const Routes = Layer.mergeAll(
  HttpApiBuilder.layer(Api).pipe(Layer.provide([ApiHandlers, PostsHandlers])),
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
