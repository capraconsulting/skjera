import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Option, Redacted } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { KeyValueStore } from "effect/persistence";
import { AuthRoutes, LoginFailurePage } from "../src/AuthRoutes.ts";
import { Identity } from "../src/Identity.ts";
import type { LoginFailure } from "../src/LoginFailure.ts";
import { AccessDenied, OAuthClient, OAuthError } from "../src/OAuthClient.ts";
import { Sessions } from "../src/Sessions.ts";
import { configLayer } from "./layers.ts";

// The redirect URI is https, so the cookies carry the `__Host-` prefix.
const loginCookie = "__Host-skjera_login";
const returnCookie = "__Host-skjera_return";
const sessionCookie = "__Host-skjera_session";

const identity = new Identity({
  issuer: "https://idp.example",
  subject: "alice",
  email: "alice@example.com",
});

type CompleteLogin = OAuthClient["Service"]["completeLogin"];

const succeeds: CompleteLogin = () =>
  Effect.succeed({
    identity,
    tokens: {
      accessToken: Redacted.make("access"),
      refreshToken: Option.none(),
      idToken: Option.none(),
      expiresAt: Option.none(),
    },
  });
const succeedsWithIdToken: CompleteLogin = () =>
  Effect.succeed({
    identity,
    tokens: {
      accessToken: Redacted.make("access"),
      refreshToken: Option.none(),
      idToken: Option.some("identity-token"),
      expiresAt: Option.none(),
    },
  });
const refused: CompleteLogin = () =>
  Effect.fail(new AccessDenied({ message: "outside the domain" }));
const unusable: CompleteLogin = () =>
  Effect.fail(new OAuthError({ message: "bad answer" }));

/**
 * The login routes over a stub provider, and a failure page that answers 200
 * and writes down what it was asked to show. `use` gets a way to request them
 * and the failures shown so far.
 */
const withRoutes = <A, E, R>(
  completeLogin: CompleteLogin,
  use: (routes: {
    readonly request: (
      path: string,
      cookie?: string,
      method?: string,
    ) => Effect.Effect<Response>;
    readonly shown: ReadonlyArray<LoginFailure>;
    readonly endedWith: ReadonlyArray<Option.Option<string>>;
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const shown: Array<LoginFailure> = [];
    const endedWith: Array<Option.Option<string>> = [];
    const client = Layer.succeed(
      OAuthClient,
      OAuthClient.of({
        authorizationServer: { issuer: "https://idp.example" },
        startLogin: Effect.succeed({
          url: new URL("https://idp.example/authorize"),
          challenge: { state: "state", codeVerifier: "verifier" },
        }),
        completeLogin,
        endSessionUrl: (idToken) => {
          endedWith.push(idToken);
          return Option.none();
        },
      }),
    );
    const page = Layer.succeed(LoginFailurePage, (failure) => {
      shown.push(failure);
      return Effect.succeed(HttpServerResponse.text("a page", { status: 200 }));
    });
    const app = AuthRoutes.pipe(
      Layer.provide(client),
      Layer.provide(page),
      Layer.provide(Sessions.layer),
      Layer.provide(KeyValueStore.layerMemory),
      Layer.provide(configLayer()),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(app, {
      disableLogger: true,
    });
    yield* Effect.addFinalizer(() => Effect.promise(dispose));
    return yield* use({
      shown,
      endedWith,
      request: (path, cookie, method) =>
        Effect.promise(() =>
          handler(
            new Request(`https://app.example${path}`, {
              ...(method === undefined ? {} : { method }),
              headers: cookie === undefined ? {} : { cookie },
            }),
          ),
        ),
    });
  }).pipe(Effect.scoped);

/** The cookies a response sets, as the `Cookie` header a browser sends back. */
const cookieHeader = (response: Response, ...names: ReadonlyArray<string>) =>
  response.headers
    .getSetCookie()
    .map((setCookie) => setCookie.split(";")[0] ?? "")
    .filter((pair) => names.some((name) => pair.startsWith(`${name}=`)))
    .join("; ");

const setCookieNames = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((setCookie) => (setCookie.split("=")[0] ?? "").trim());

const login = (
  request: (path: string, cookie?: string) => Effect.Effect<Response>,
  returnTo: string,
) => request(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);

const callback = "/auth/callback?code=x&state=state";

describe("AuthRoutes", () => {
  it.effect("passes the ID token to provider logout (AC-3)", () =>
    withRoutes(succeedsWithIdToken, ({ request, endedWith }) =>
      Effect.gen(function* () {
        const started = yield* login(request, "/");
        const loggedIn = yield* request(
          callback,
          cookieHeader(started, loginCookie, returnCookie),
        );

        yield* request(
          "/auth/logout",
          cookieHeader(loggedIn, sessionCookie),
          "POST",
        );
        assert.deepStrictEqual(endedWith, [Option.some("identity-token")]);
      }),
    ),
  );

  it.effect(
    "refuses an account that is not allowed, with no session (AC-1, AC-5)",
    () =>
      withRoutes(refused, ({ request, shown }) =>
        Effect.gen(function* () {
          const started = yield* login(request, "/events/abc");
          const response = yield* request(
            callback,
            cookieHeader(started, loginCookie, returnCookie),
          );

          assert.deepStrictEqual(shown, [
            { kind: "denied", returnTo: "/events/abc" },
          ]);
          assert.strictEqual(response.status, 403);
          assert.notInclude(setCookieNames(response), sessionCookie);
        }),
      ),
  );

  it.effect(
    "an answer that can't be used is a failed login, with where it was going (AC-3, AC-5)",
    () =>
      withRoutes(unusable, ({ request, shown }) =>
        Effect.gen(function* () {
          const started = yield* login(request, "/events/abc");
          const response = yield* request(
            callback,
            cookieHeader(started, loginCookie, returnCookie),
          );

          assert.deepStrictEqual(shown, [
            { kind: "failed", returnTo: "/events/abc" },
          ]);
          assert.strictEqual(response.status, 401);
          assert.notInclude(setCookieNames(response), sessionCookie);
        }),
      ),
  );

  it.effect(
    "a callback without its login is expired, back to where it was going (AC-2, AC-5)",
    () =>
      withRoutes(succeeds, ({ request, shown }) =>
        Effect.gen(function* () {
          const started = yield* login(request, "/account");
          const cookie = cookieHeader(started, loginCookie, returnCookie);

          // The first answer logs in; the same callback again is a replay.
          const first = yield* request(callback, cookie);
          assert.strictEqual(first.status, 302);
          const replay = yield* request(callback, cookie);
          assert.strictEqual(replay.status, 400);
          assert.notInclude(setCookieNames(replay), sessionCookie);

          // Only the return cookie left, as after the login's ten minutes.
          yield* request(callback, cookieHeader(started, returnCookie));
          // Nothing at all, and a return cookie that points at another site.
          yield* request(callback);
          yield* request(
            callback,
            `${returnCookie}=${encodeURIComponent("https://evil.example/")}`,
          );

          assert.deepStrictEqual(shown, [
            { kind: "expired", returnTo: "/account" },
            { kind: "expired", returnTo: "/account" },
            { kind: "expired", returnTo: "/" },
            { kind: "expired", returnTo: "/" },
          ]);
        }),
      ),
  );

  it.effect("the login sets where it returns to (AC-4)", () =>
    withRoutes(succeeds, ({ request, shown }) =>
      Effect.gen(function* () {
        const path = "/events/abc?x=1;y=2,3";
        const started = yield* login(request, path);
        assert.include(setCookieNames(started), returnCookie);

        yield* request(callback, cookieHeader(started, returnCookie));
        assert.deepStrictEqual(shown, [{ kind: "expired", returnTo: path }]);
      }),
    ),
  );
});
