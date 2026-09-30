// A minimal app for trying the login flow by hand and for the Playwright
// tests. Run with `pnpm dev` from the repo root.
import { createServer } from "node:http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpRouter, HttpServerResponse } from "effect/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/http-api";
import { KeyValueStore } from "effect/persistence";
import * as OAuth from "../src/index.ts";

class DevApi extends HttpApi.make("dev").add(
  HttpApiGroup.make("session")
    .add(HttpApiEndpoint.get("me", "/api/me", { success: OAuth.Identity }))
    .middleware(OAuth.Authentication),
) {}

const DevApiHandlers = HttpApiBuilder.group(DevApi, "session", (handlers) =>
  handlers.handle("me", () =>
    Effect.gen(function* () {
      return yield* OAuth.CurrentUser;
    }),
  ),
);

const home = `<!doctype html>
<title>Skjera auth dev</title>
<h1>Skjera auth dev</h1>
<p id="status">Checking session…</p>
<a id="login" href="/auth/login?returnTo=/">Log in</a>
<form method="post" action="/auth/logout"><button id="logout">Log out</button></form>
<script type="module">
  const response = await fetch("/api/me")
  const status = document.getElementById("status")
  if (response.ok) {
    const me = await response.json()
    status.textContent = "Logged in as " + (me.email ?? me.subject)
  } else {
    status.textContent = "Not logged in"
  }
</script>
`;

const Routes = Layer.mergeAll(
  HttpApiBuilder.layer(DevApi).pipe(Layer.provide(DevApiHandlers)),
  HttpRouter.add("GET", "/", HttpServerResponse.html(home)),
  HttpRouter.add("GET", "/health", HttpServerResponse.text("ok")),
).pipe(Layer.provideMerge(OAuth.routes));

// The services (with provider discovery) are built before the HTTP server,
// which accepts connections as soon as it exists.
HttpRouter.serve(Routes).pipe(
  Layer.provide(
    NodeHttpServer.layer(createServer, {
      port: Number(process.env.PORT ?? 3000),
    }),
  ),
  Layer.provide(OAuth.services),
  Layer.provide([FetchHttpClient.layer, KeyValueStore.layerMemory]),
  Layer.launch,
  NodeRuntime.runMain,
);
