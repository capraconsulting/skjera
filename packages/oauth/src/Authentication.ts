import { Context, Schema } from "effect";
import { HttpApiMiddleware } from "effect/http-api";
import type { Identity } from "./Identity.ts";

// These definitions are safe to share with API clients. The server-side
// implementation lives in AuthRoutes.ts.

export class CurrentUser extends Context.Service<CurrentUser, Identity>()(
  "@skjera/oauth/CurrentUser",
) {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

/**
 * Requires a valid session cookie and provides the `CurrentUser` to the
 * endpoints it is applied to.
 */
export class Authentication extends HttpApiMiddleware.Service<
  Authentication,
  {
    provides: CurrentUser;
  }
>()("@skjera/oauth/Authentication", {
  error: Unauthorized,
}) {}
