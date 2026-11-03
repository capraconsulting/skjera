import {
  Clock,
  Context,
  Data,
  Effect,
  Layer,
  Option,
  Redacted,
  Schedule,
} from "effect";
import { HttpClient, HttpClientRequest, type HttpMethod } from "effect/http";
import * as oauth from "oauth4webapi";
import { Identity } from "./Identity.ts";
import {
  accountDomain,
  googleIssuer,
  isDomainAllowed,
} from "./internal/allowedDomains.ts";
import { OAuthConfig } from "./OAuthConfig.ts";

export class OAuthError extends Data.TaggedError("OAuthError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** The provider accepted the user, but they're not allowed to use this app. */
export class AccessDenied extends Data.TaggedError("AccessDenied")<{
  readonly message: string;
}> {}

/** Everything needed to verify the callback for one login attempt. Keep it secret. */
export interface LoginChallenge {
  readonly state: string;
  readonly codeVerifier: string;
  readonly nonce?: string | undefined;
}

export interface Tokens {
  readonly accessToken: Redacted.Redacted<string>;
  readonly refreshToken: Option.Option<Redacted.Redacted<string>>;
  readonly idToken: Option.Option<string>;
  /** Epoch milliseconds, when the provider told us. */
  readonly expiresAt: Option.Option<number>;
}

/**
 * The OAuth 2.0 / OpenID Connect relying party: builds authorization URLs and
 * turns callbacks into an `Identity` using the authorization code flow with
 * PKCE. Protocol details are delegated to oauth4webapi, and all HTTP traffic
 * goes through the Effect `HttpClient`.
 */
export class OAuthClient extends Context.Service<
  OAuthClient,
  {
    readonly authorizationServer: oauth.AuthorizationServer;
    readonly startLogin: Effect.Effect<{
      readonly url: URL;
      readonly challenge: LoginChallenge;
    }>;
    readonly completeLogin: (
      callbackUrl: URL,
      challenge: LoginChallenge,
    ) => Effect.Effect<
      { readonly identity: Identity; readonly tokens: Tokens },
      OAuthError | AccessDenied
    >;
    readonly refresh: (
      refreshToken: Redacted.Redacted<string>,
    ) => Effect.Effect<Tokens, OAuthError>;
    /** Where to send the browser to also end the session at the provider, if supported and configured. */
    readonly endSessionUrl: (
      idToken: Option.Option<string>,
    ) => Option.Option<URL>;
  }
>()("@skjera/oauth/OAuthClient") {
  static readonly layer = Layer.effect(
    OAuthClient,
    Effect.gen(function* () {
      const config = yield* OAuthConfig;
      const httpClient = yield* HttpClient.HttpClient;

      // oauth4webapi speaks fetch, so bridge its requests onto the Effect
      // HttpClient to get tracing, test doubles and whatever transport the
      // application provides.
      const customFetch = (
        url: string,
        options: oauth.CustomFetchOptions<string, unknown>,
      ): Promise<Response> =>
        Effect.runPromise(
          Effect.gen(function* () {
            let request = HttpClientRequest.make(
              options.method as HttpMethod.HttpMethod,
            )(url, {
              headers: options.headers,
            });
            if (options.body !== undefined && options.body !== null) {
              request = HttpClientRequest.bodyText(
                request,
                String(options.body),
                options.headers["content-type"],
              );
            }
            const response = yield* httpClient.execute(request);
            const body = yield* response.arrayBuffer;
            return new Response(body.byteLength > 0 ? body : null, {
              status: response.status,
              headers: Object.entries(response.headers),
            });
          }),
          { signal: options.signal },
        );

      const httpOptions = {
        [oauth.customFetch]: customFetch,
        [oauth.allowInsecureRequests]: config.allowInsecureRequests,
      };

      const tryPromise = <A>(message: string, f: () => Promise<A>) =>
        Effect.tryPromise({
          try: f,
          catch: (cause) =>
            new OAuthError({ message: describe(message, cause), cause }),
        });

      const overrides = Object.fromEntries(
        Object.entries({
          authorization_endpoint: config.endpoints.authorization,
          token_endpoint: config.endpoints.token,
          userinfo_endpoint: config.endpoints.userinfo,
          end_session_endpoint: config.endpoints.endSession,
        }).flatMap(([key, url]) =>
          Option.isSome(url) ? [[key, url.value.href]] : [],
        ),
      );

      // Providers without a discovery document are configured by setting the
      // endpoints explicitly.
      const skipDiscovery =
        overrides.authorization_endpoint !== undefined &&
        overrides.token_endpoint !== undefined;
      const discovered: oauth.AuthorizationServer = skipDiscovery
        ? // URL adds a trailing slash to bare origins; keep the issuer as written.
          {
            issuer:
              config.issuer.pathname === "/"
                ? config.issuer.origin
                : config.issuer.href,
          }
        : yield* tryPromise(
            `Discovery failed for ${config.issuer.href}`,
            async () =>
              oauth.processDiscoveryResponse(
                config.issuer,
                await oauth.discoveryRequest(config.issuer, {
                  ...httpOptions,
                  algorithm: config.discovery,
                }),
              ),
          ).pipe(
            Effect.retry({
              schedule: Schedule.exponential("250 millis"),
              times: 4,
            }),
          );
      const as: oauth.AuthorizationServer = { ...discovered, ...overrides };

      if (
        as.authorization_endpoint === undefined ||
        as.token_endpoint === undefined
      ) {
        return yield* new OAuthError({
          message: `${config.issuer.href} has no authorization or token endpoint; set them explicitly`,
        });
      }
      const authorizationEndpoint = as.authorization_endpoint;

      const client: oauth.Client = { client_id: config.clientId };
      const clientSecret = Redacted.value(config.clientSecret);
      const authMethod = Option.getOrElse(
        config.tokenEndpointAuthMethod,
        () => {
          const supported = as.token_endpoint_auth_methods_supported;
          return supported === undefined ||
            supported.includes("client_secret_basic")
            ? "client_secret_basic"
            : "client_secret_post";
        },
      );
      const clientAuth =
        authMethod === "client_secret_basic"
          ? oauth.ClientSecretBasic(clientSecret)
          : oauth.ClientSecretPost(clientSecret);

      const isOpenIdConnect = config.scopes.includes("openid");

      const startLogin = Effect.gen(function* () {
        const challenge: LoginChallenge = {
          state: oauth.generateRandomState(),
          codeVerifier: oauth.generateRandomCodeVerifier(),
          nonce: isOpenIdConnect ? oauth.generateRandomNonce() : undefined,
        };
        const codeChallenge = yield* Effect.promise(() =>
          oauth.calculatePKCECodeChallenge(challenge.codeVerifier),
        );

        const url = new URL(authorizationEndpoint);
        url.searchParams.set("client_id", config.clientId);
        url.searchParams.set("redirect_uri", config.redirectUri.href);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("scope", config.scopes.join(" "));
        url.searchParams.set("state", challenge.state);
        url.searchParams.set("code_challenge", codeChallenge);
        url.searchParams.set("code_challenge_method", "S256");
        if (challenge.nonce !== undefined) {
          url.searchParams.set("nonce", challenge.nonce);
        }
        // Only a hint for Google's account picker; the callback enforces it.
        if (as.issuer === googleIssuer && config.allowedDomains.length > 0) {
          const [only] = config.allowedDomains;
          url.searchParams.set(
            "hd",
            config.allowedDomains.length === 1 && only ? only : "*",
          );
        }
        return { url, challenge };
      }).pipe(Effect.withSpan("OAuthClient.startLogin"));

      const toTokens = Effect.fnUntraced(function* (
        response: oauth.TokenEndpointResponse,
      ) {
        const now = yield* Clock.currentTimeMillis;
        return {
          accessToken: Redacted.make(response.access_token),
          refreshToken: Option.fromNullishOr(response.refresh_token).pipe(
            Option.map(Redacted.make),
          ),
          idToken: Option.fromNullishOr(response.id_token),
          expiresAt: Option.fromNullishOr(response.expires_in).pipe(
            Option.map((seconds) => now + seconds * 1000),
          ),
        } satisfies Tokens;
      });

      const userInfoClient = httpClient.pipe(HttpClient.filterStatusOk);
      const fetchUserInfo = (accessToken: string) => {
        if (as.userinfo_endpoint === undefined) {
          return Effect.fail(
            new OAuthError({
              message:
                "No ID token was returned and no userinfo endpoint is known",
            }),
          );
        }
        return HttpClientRequest.get(as.userinfo_endpoint).pipe(
          HttpClientRequest.bearerToken(accessToken),
          HttpClientRequest.acceptJson,
          userInfoClient.execute,
          Effect.flatMap((response) => response.json),
          Effect.mapError(
            (cause) =>
              new OAuthError({ message: "Userinfo request failed", cause }),
          ),
        );
      };

      const toIdentity = (claims: unknown) => {
        const record =
          typeof claims === "object" && claims !== null
            ? (claims as Record<string, unknown>)
            : {};
        const domain = accountDomain(as.issuer, record, config.claims.email);
        if (!isDomainAllowed(config.allowedDomains, domain)) {
          return Effect.fail(
            new AccessDenied({
              message: `Account domain ${domain ?? "(unverified)"} is not allowed`,
            }),
          );
        }
        const subject = record[config.claims.subject];
        if (typeof subject !== "string" && typeof subject !== "number") {
          return Effect.fail(
            new OAuthError({
              message: `Missing subject claim "${config.claims.subject}"`,
            }),
          );
        }
        const email = record[config.claims.email];
        const name = record[config.claims.name];
        const picture = pictureAddress(record.picture);
        return Effect.succeed(
          new Identity({
            issuer: as.issuer,
            subject: String(subject),
            email: typeof email === "string" ? email : undefined,
            name: typeof name === "string" ? name : undefined,
            ...(picture === undefined ? {} : { picture }),
          }),
        );
      };

      const completeLogin = Effect.fn("OAuthClient.completeLogin")(function* (
        callbackUrl: URL,
        challenge: LoginChallenge,
      ) {
        const parameters = yield* Effect.try({
          try: () =>
            oauth.validateAuthResponse(
              as,
              client,
              callbackUrl,
              challenge.state,
            ),
          catch: (cause) =>
            new OAuthError({
              message: describe("Invalid authorization response", cause),
              cause,
            }),
        });
        const response = yield* tryPromise("Token request failed", async () =>
          oauth.processAuthorizationCodeResponse(
            as,
            client,
            await oauth.authorizationCodeGrantRequest(
              as,
              client,
              clientAuth,
              parameters,
              config.redirectUri.href,
              challenge.codeVerifier,
              httpOptions,
            ),
            {
              expectedNonce: challenge.nonce ?? oauth.expectNoNonce,
              requireIdToken: isOpenIdConnect,
            },
          ),
        );
        // Plain OAuth 2.0 providers don't issue ID tokens, so ask the
        // userinfo endpoint who the user is instead.
        const claims =
          oauth.getValidatedIdTokenClaims(response) ??
          (yield* fetchUserInfo(response.access_token));
        const identity = yield* toIdentity(claims);
        const tokens = yield* toTokens(response);
        return { identity, tokens };
      });

      const refresh = Effect.fn("OAuthClient.refresh")(function* (
        refreshToken: Redacted.Redacted<string>,
      ) {
        const response = yield* tryPromise("Refresh request failed", async () =>
          oauth.processRefreshTokenResponse(
            as,
            client,
            await oauth.refreshTokenGrantRequest(
              as,
              client,
              clientAuth,
              Redacted.value(refreshToken),
              httpOptions,
            ),
          ),
        );
        return yield* toTokens(response);
      });

      const endSessionUrl = (idToken: Option.Option<string>) => {
        const endpoint = as.end_session_endpoint;
        if (
          endpoint === undefined ||
          Option.isNone(config.postLogoutRedirectUri)
        ) {
          return Option.none();
        }
        const url = new URL(endpoint);
        url.searchParams.set("client_id", config.clientId);
        url.searchParams.set(
          "post_logout_redirect_uri",
          config.postLogoutRedirectUri.value.href,
        );
        if (Option.isSome(idToken)) {
          url.searchParams.set("id_token_hint", idToken.value);
        }
        return Option.some(url);
      };

      return OAuthClient.of({
        authorizationServer: as,
        startLogin,
        completeLogin,
        refresh,
        endSessionUrl,
      });
    }),
  );
}

/** The `picture` claim when it is an `https:` address, else none. */
const pictureAddress = (claim: unknown): string | undefined => {
  if (typeof claim !== "string") return undefined;
  return URL.canParse(claim) && new URL(claim).protocol === "https:"
    ? claim
    : undefined;
};

const describe = (message: string, cause: unknown): string => {
  if (
    cause instanceof oauth.AuthorizationResponseError ||
    cause instanceof oauth.ResponseBodyError
  ) {
    return `${message}: ${cause.error}${cause.error_description ? ` (${cause.error_description})` : ""}`;
  }
  return cause instanceof Error ? `${message}: ${cause.message}` : message;
};
