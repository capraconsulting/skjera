// The Skjera backend: login, the HTTP API, table sync, the WebSocket
// drafts sync over, and images.
// Stateless: sessions and documents live in Postgres, images in S3, so any number of
// instances can run side by side.
import { createServer } from "node:http";
import { NodeCrypto, NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import * as Documents from "@skjera/documents";
import * as Email from "@skjera/email";
import * as OAuth from "@skjera/oauth";
import { Config, Effect, Layer } from "effect";
import { FetchHttpClient, HttpRouter, HttpStaticServer } from "effect/http";
import { KeyValueStore } from "effect/persistence";
import { Health } from "./health.ts";

/**
 * The built app (packages/app) from `STATIC_DIR`, in production; Vite
 * serves it in development. Paths that aren't files are the app's, which
 * it routes in the browser.
 */
const App = Layer.unwrap(
  Effect.gen(function* () {
    const root = yield* Documents.optionalSetting("STATIC_DIR", Config.String);
    if (root === undefined) return Layer.empty;
    return Layer.mergeAll(
      // Named by their content, so they never change.
      HttpStaticServer.layer({
        root: `${root}/assets`,
        prefix: "/assets",
        cacheControl: "public, max-age=31536000, immutable",
      }),
      // The app's files, and its pages with what search engines and shared
      // links are told.
      Documents.Sharing.layerHttp({ root }),
    );
  }),
);

/**
 * A failed login's page: the built app, with what failed in its head, for
 * the app to say so in the visitor's language. Without STATIC_DIR (in
 * development) the login routes keep their plain answers.
 */
const LoginFailurePage = Layer.unwrap(
  Effect.gen(function* () {
    const root = yield* Documents.optionalSetting("STATIC_DIR", Config.String);
    if (root === undefined) return Layer.empty;
    return Documents.Sharing.layerLoginFailurePage({ root });
  }),
);

/**
 * The site's own files, e.g. its logo, from `SITE_ASSETS_DIR`: so they can be
 * mounted beside the image (a ConfigMap) instead of hosted elsewhere.
 */
const SiteAssets = Layer.unwrap(
  Effect.gen(function* () {
    const root = yield* Documents.optionalSetting(
      "SITE_ASSETS_DIR",
      Config.String,
    );
    return root === undefined
      ? Layer.empty
      : HttpStaticServer.layer({
          root,
          prefix: "/site-assets",
          cacheControl: "public, max-age=300",
        });
  }),
);

const Routes = Layer.mergeAll(
  Documents.ApiHandlers,
  Documents.DraftSync.layerHttp({ path: Documents.draftSyncPath }),
  // The next events, for the websites to show in an iframe.
  Documents.Embed.layerHttp,
  // The coming events as JSON, in Skjer's format, for the websites.
  Documents.PublicEvents.layerHttp,
  // The coming events as a calendar to subscribe to, members only ones too.
  Documents.CalendarFeed.layerHttp,
  // What a phone is told when the site is added to its home screen.
  Documents.Manifest.layerHttp,
  Health,
  SiteAssets,
  App,
).pipe(Layer.provideMerge(OAuth.routes.pipe(Layer.provide(LoginFailurePage))));

const Server = Layer.unwrap(
  Effect.gen(function* () {
    const port = yield* Config.Port("PORT").pipe(Config.withDefault(3000));
    // Unset: every interface.
    const host = yield* Documents.optionalSetting("HOST", Config.String);
    return NodeHttpServer.layer(
      createServer,
      host === undefined ? { port } : { port, host },
    );
  }),
);

// Services are built first (database, migrations, provider discovery): the
// HTTP server accepts connections as soon as it exists, and requests that
// arrive before the routes are served would get no response.
HttpRouter.serve(Routes).pipe(
  Layer.provide(Server),
  Layer.provide(Documents.SignupLimits.layer),
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
