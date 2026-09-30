import { type Duration, Effect, Layer, Option, Result } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { Authentication, CurrentUser, Unauthorized } from "./Authentication.ts";
import { sanitizeReturnTo } from "./internal/returnTo.ts";
import { OAuthClient } from "./OAuthClient.ts";
import { OAuthConfig } from "./OAuthConfig.ts";
import { loginAttemptTtl, Sessions } from "./Sessions.ts";

export const loginPath = "/auth/login";
export const logoutPath = "/auth/logout";

/**
 * Cookie names and attributes. Over https the `__Host-` prefix makes the
 * browser enforce Secure, Path=/ and no Domain, so the cookies can't be set or
 * read by sibling subdomains.
 */
const makeCookies = (config: OAuthConfig["Service"]) => {
  const secure = config.redirectUri.protocol === "https:";
  const prefix = secure ? "__Host-" : "";
  const options = (maxAge?: Duration.Duration) => ({
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    ...(maxAge === undefined ? {} : { maxAge }),
  });
  return {
    session: `${prefix}skjera_session`,
    login: `${prefix}skjera_login`,
    options,
  };
};

const requestUrl = (
  request: HttpServerRequest.HttpServerRequest,
  config: OAuthConfig["Service"],
) => new URL(request.url, config.redirectUri);

/**
 * Routes for the server-side login flow:
 *
 * - `GET /auth/login?returnTo=/path` redirects to the provider.
 * - `GET <path of OAUTH_REDIRECT_URI>` finishes the login and sets the session cookie.
 * - `POST /auth/logout` ends the session, and at the provider too when configured.
 */
export const AuthRoutes = HttpRouter.use(
  Effect.fnUntraced(function* (router) {
    const config = yield* OAuthConfig;
    const client = yield* OAuthClient;
    const sessions = yield* Sessions;
    const cookies = makeCookies(config);

    yield* router.add(
      "GET",
      loginPath,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const returnTo = sanitizeReturnTo(
          requestUrl(request, config).searchParams.get("returnTo"),
        );
        const { url, challenge } = yield* client.startLogin;
        const loginId = yield* sessions.startLogin({ ...challenge, returnTo });
        return yield* HttpServerResponse.redirect(url).pipe(
          HttpServerResponse.setCookie(
            cookies.login,
            loginId,
            cookies.options(loginAttemptTtl),
          ),
        );
      }).pipe(Effect.orDie),
    );

    yield* router.add(
      "GET",
      config.redirectUri.pathname as HttpRouter.PathInput,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const loginId = request.cookies[cookies.login];
        const attempt =
          loginId === undefined
            ? Option.none()
            : yield* sessions.takeLogin(loginId);
        if (Option.isNone(attempt)) {
          return HttpServerResponse.text(
            "Login expired or was already used. Please try again.",
            { status: 400 },
          );
        }

        const result = yield* client
          .completeLogin(requestUrl(request, config), attempt.value)
          .pipe(
            Effect.tapError((error) =>
              Effect.logWarning("Login failed", error),
            ),
            Effect.result,
          );
        if (Result.isFailure(result)) {
          return result.failure._tag === "AccessDenied"
            ? HttpServerResponse.text(
                "This account is not allowed to sign in.",
                { status: 403 },
              )
            : HttpServerResponse.text("Login failed.", { status: 401 });
        }

        // Always issue a fresh session id on login, and drop any previous one.
        const previous = request.cookies[cookies.session];
        if (previous !== undefined) {
          yield* sessions.remove(previous);
        }
        const sessionId = yield* sessions.create(
          result.success.identity,
          result.success.tokens,
        );
        return yield* HttpServerResponse.redirect(attempt.value.returnTo).pipe(
          HttpServerResponse.setCookie(
            cookies.session,
            sessionId,
            cookies.options(config.sessionTtl),
          ),
        );
      }).pipe(
        Effect.flatMap(
          HttpServerResponse.expireCookie(cookies.login, cookies.options()),
        ),
        Effect.orDie,
      ),
    );

    // POST only, so a cross-site link or image can't log the user out.
    yield* router.add(
      "POST",
      logoutPath,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const sessionId = request.cookies[cookies.session];
        let idToken = Option.none<string>();
        if (sessionId !== undefined) {
          const session = yield* sessions.get(sessionId);
          idToken = Option.flatMap(session, (session) =>
            Option.fromUndefinedOr(session.idToken),
          );
          yield* sessions.remove(sessionId);
        }
        const location = Option.getOrElse(
          client.endSessionUrl(idToken),
          () => "/",
        );
        return yield* HttpServerResponse.redirect(location, {
          status: 303,
        }).pipe(
          HttpServerResponse.expireCookie(cookies.session, cookies.options()),
        );
      }).pipe(Effect.orDie),
    );
  }),
);

/** Server implementation of the `Authentication` middleware, backed by the session cookie. */
export const AuthenticationLive = Layer.effect(
  Authentication,
  Effect.gen(function* () {
    const config = yield* OAuthConfig;
    const sessions = yield* Sessions;
    const cookies = makeCookies(config);

    return Authentication.of((httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const sessionId = request.cookies[cookies.session];
        if (sessionId === undefined) {
          return yield* new Unauthorized({ message: "Not logged in" });
        }
        const session = yield* sessions.get(sessionId).pipe(Effect.orDie);
        if (Option.isNone(session)) {
          return yield* new Unauthorized({ message: "Session expired" });
        }
        return yield* Effect.provideService(
          httpEffect,
          CurrentUser,
          session.value.identity,
        );
      }),
    );
  }),
);
