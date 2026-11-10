import { appPaths, appQuery, callbackPath } from "@skjera/paths";
import { Context, type Duration, Effect, Layer, Option, Result } from "effect";
import {
  Cookies,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import {
  Authentication,
  CurrentUser,
  ForbiddenOrigin,
  Unauthorized,
} from "./Authentication.ts";
import type { Identity } from "./Identity.ts";
import { sanitizeReturnTo } from "./internal/returnTo.ts";
import type { LoginFailure, LoginFailureKind } from "./LoginFailure.ts";
import { OAuthClient } from "./OAuthClient.ts";
import { OAuthConfig } from "./OAuthConfig.ts";
import { loginAttemptTtl, Sessions } from "./Sessions.ts";

export const loginPath = appPaths.login;
export const logoutPath = appPaths.logout;

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
    // Where the login is going. It outlives the login cookie, so a login
    // that expired still knows where to return to.
    returnTo: `${prefix}skjera_return`,
    options,
  };
};

const requestUrl = (
  request: HttpServerRequest.HttpServerRequest,
  config: OAuthConfig["Service"],
) => new URL(request.url, config.redirectUri);

const failureStatus = { denied: 403, expired: 400, failed: 401 } as const;

const plainAnswers: Record<LoginFailureKind, string> = {
  denied: "This account is not allowed to sign in.",
  expired: "Login expired or was already used. Please try again.",
  failed: "Login failed.",
};

/**
 * What the callback answers a failed login with; the route sets the status.
 * By default a line of text: a server with a page to show provides its own.
 */
export const LoginFailurePage = Context.Reference<
  (
    failure: LoginFailure,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse>
>("@skjera/oauth/LoginFailurePage", {
  defaultValue: () => (failure) =>
    Effect.succeed(HttpServerResponse.text(plainAnswers[failure.kind])),
});

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
    const failurePage = yield* LoginFailurePage;
    const fail = (failure: LoginFailure) =>
      failurePage(failure).pipe(
        Effect.map(HttpServerResponse.setStatus(failureStatus[failure.kind])),
      );

    yield* router.add(
      "GET",
      loginPath,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const returnTo = sanitizeReturnTo(
          requestUrl(request, config).searchParams.get(appQuery.returnTo),
        );
        const { url, challenge } = yield* client.startLogin;
        const loginId = yield* sessions.startLogin({ ...challenge, returnTo });
        return yield* HttpServerResponse.redirect(url).pipe(
          HttpServerResponse.setCookie(
            cookies.login,
            loginId,
            cookies.options(loginAttemptTtl),
          ),
          Effect.flatMap(
            HttpServerResponse.setCookie(
              cookies.returnTo,
              returnTo,
              cookies.options(),
            ),
          ),
        );
      }).pipe(Effect.orDie),
    );

    yield* router.add(
      "GET",
      callbackPath(config.redirectUri) as HttpRouter.PathInput,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const loginId = request.cookies[cookies.login];
        const attempt =
          loginId === undefined
            ? Option.none()
            : yield* sessions.takeLogin(loginId);
        if (Option.isNone(attempt)) {
          // The attempt is gone, and with it where it was going: the return
          // cookie outlives it.
          return yield* fail({
            kind: "expired",
            returnTo: sanitizeReturnTo(request.cookies[cookies.returnTo]),
          });
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
          return yield* fail({
            kind: result.failure._tag === "AccessDenied" ? "denied" : "failed",
            returnTo: attempt.value.returnTo,
          });
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

/**
 * Resolves the session cookie to the signed-in user, for anything that needs
 * to authenticate requests outside `HttpApi` (e.g. WebSocket upgrades).
 */
export class Authenticator extends Context.Service<
  Authenticator,
  {
    readonly fromCookies: (
      cookies: Readonly<Record<string, string | undefined>>,
    ) => Effect.Effect<Option.Option<Identity>>;
    readonly fromCookieHeader: (
      header: string | undefined,
    ) => Effect.Effect<Option.Option<Identity>>;
    /**
     * The origin the app is served from (that of OAUTH_REDIRECT_URI). Requests
     * carrying the session cookie from any other origin should be refused.
     */
    readonly origin: string;
  }
>()("@skjera/oauth/Authenticator") {
  static readonly layer = Layer.effect(
    Authenticator,
    Effect.gen(function* () {
      const config = yield* OAuthConfig;
      const sessions = yield* Sessions;
      const cookies = makeCookies(config);

      const fromCookies = (
        values: Readonly<Record<string, string | undefined>>,
      ) => {
        const sessionId = values[cookies.session];
        return sessionId === undefined
          ? Effect.succeedNone
          : sessions
              .get(sessionId)
              .pipe(
                Effect.map(Option.map((session) => session.identity)),
                Effect.orDie,
              );
      };

      return Authenticator.of({
        fromCookies,
        fromCookieHeader: (header) =>
          fromCookies(header === undefined ? {} : Cookies.parseHeader(header)),
        origin: config.redirectUri.origin,
      });
    }),
  );
}

/** Server implementation of the `Authentication` middleware, backed by the session cookie. */
export const AuthenticationLive = Layer.effect(
  Authentication,
  Effect.gen(function* () {
    const authenticator = yield* Authenticator;

    return Authentication.of((httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const identity = yield* authenticator.fromCookies(request.cookies);
        if (Option.isNone(identity)) {
          return yield* new Unauthorized({ message: "Not logged in" });
        }
        const origin = request.headers.origin;
        if (
          !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
          origin !== undefined &&
          origin !== authenticator.origin
        ) {
          return yield* new ForbiddenOrigin({
            message: "Request origin is not allowed",
          });
        }
        return yield* Effect.provideService(
          httpEffect,
          CurrentUser,
          identity.value,
        );
      }),
    );
  }),
);
