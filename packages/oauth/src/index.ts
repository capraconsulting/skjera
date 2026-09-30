import { Layer } from "effect";
import { AuthenticationLive, AuthRoutes } from "./AuthRoutes.ts";
import { OAuthClient } from "./OAuthClient.ts";
import { OAuthConfig } from "./OAuthConfig.ts";
import { Sessions } from "./Sessions.ts";

export * from "./Authentication.ts";
export * from "./AuthRoutes.ts";
export * from "./Identity.ts";
export * from "./OAuthClient.ts";
export * from "./OAuthConfig.ts";
export * from "./Sessions.ts";

/**
 * The auth routes and `Authentication` middleware, configured from the
 * environment. Requires an `HttpClient` for talking to the provider and a
 * `KeyValueStore` for sessions.
 */
export const layer = Layer.mergeAll(AuthRoutes, AuthenticationLive).pipe(
  Layer.provide(Layer.mergeAll(OAuthClient.layer, Sessions.layer)),
  Layer.provide(OAuthConfig.layer),
);
