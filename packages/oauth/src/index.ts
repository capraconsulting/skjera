import { Layer } from "effect";
import { AuthenticationLive, Authenticator, AuthRoutes } from "./AuthRoutes.ts";
import { OAuthClient } from "./OAuthClient.ts";
import { OAuthConfig } from "./OAuthConfig.ts";
import { Sessions } from "./Sessions.ts";

export * from "./Authentication.ts";
export * from "./AuthRoutes.ts";
export * from "./Identity.ts";
export { emailDomain, isDomainAllowed } from "./internal/allowedDomains.ts";
export * from "./OAuthClient.ts";
export * from "./OAuthConfig.ts";
export * from "./Sessions.ts";

/**
 * Everything the routes need, configured from the environment: provider
 * discovery happens here. Requires an `HttpClient` for talking to the
 * provider and a `KeyValueStore` for sessions.
 *
 * Build it before the HTTP server layer: the server accepts connections as
 * soon as its layer is built, and requests that arrive before the routes are
 * served get no response.
 */
export const services = Authenticator.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(OAuthClient.layer, Sessions.layer)),
  Layer.provideMerge(OAuthConfig.layer),
);

/** The auth routes and the `Authentication` middleware, on top of `services`. */
export const routes = Layer.mergeAll(AuthRoutes, AuthenticationLive);
