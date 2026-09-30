import {
  Config,
  Context,
  Duration,
  Effect,
  Layer,
  type Option,
  type Redacted,
} from "effect";

export type TokenEndpointAuthMethod =
  | "client_secret_basic"
  | "client_secret_post";

export class OAuthConfig extends Context.Service<
  OAuthConfig,
  {
    /** Base URL of the authorization server, used for discovery. */
    readonly issuer: URL;
    readonly clientId: string;
    readonly clientSecret: Redacted.Redacted<string>;
    /** Must be registered with the provider. Its path becomes the callback route. */
    readonly redirectUri: URL;
    readonly scopes: ReadonlyArray<string>;
    /** Which well-known document to discover: OpenID Connect or RFC 8414. */
    readonly discovery: "oidc" | "oauth2";
    /** Overrides for discovered endpoints, or all of them for providers without discovery. */
    readonly endpoints: {
      readonly authorization: Option.Option<URL>;
      readonly token: Option.Option<URL>;
      readonly userinfo: Option.Option<URL>;
      readonly endSession: Option.Option<URL>;
    };
    /** Defaults to what the provider advertises, preferring client_secret_basic. */
    readonly tokenEndpointAuthMethod: Option.Option<TokenEndpointAuthMethod>;
    /** Claim names used to build the `Identity`, for providers with non-standard claims. */
    readonly claims: {
      readonly subject: string;
      readonly email: string;
      readonly name: string;
    };
    /**
     * Only accounts in these domains may log in. Empty allows everyone the
     * provider accepts. Google is checked against the Workspace (`hd`) claim,
     * other providers against a verified email address.
     */
    readonly allowedDomains: ReadonlyArray<string>;
    /** Allows plain http:// provider URLs. Only for local development. */
    readonly allowInsecureRequests: boolean;
    /** Enables RP-initiated logout at the provider when it supports it. */
    readonly postLogoutRedirectUri: Option.Option<URL>;
    readonly sessionTtl: Duration.Duration;
  }
>()("@skjera/oauth/OAuthConfig") {
  static readonly config = Config.all({
    issuer: Config.URL("OAUTH_ISSUER"),
    clientId: Config.NonEmptyString("OAUTH_CLIENT_ID"),
    clientSecret: Config.Redacted("OAUTH_CLIENT_SECRET"),
    redirectUri: Config.URL("OAUTH_REDIRECT_URI"),
    scopes: Config.String("OAUTH_SCOPES").pipe(
      Config.withDefault("openid email profile"),
      Config.map((scopes) =>
        scopes.split(/[\s,]+/).filter((scope) => scope.length > 0),
      ),
    ),
    discovery: Config.Literals(["oidc", "oauth2"], "OAUTH_DISCOVERY").pipe(
      Config.withDefault("oidc" as const),
    ),
    endpoints: Config.all({
      authorization: Config.option(Config.URL("OAUTH_AUTHORIZATION_ENDPOINT")),
      token: Config.option(Config.URL("OAUTH_TOKEN_ENDPOINT")),
      userinfo: Config.option(Config.URL("OAUTH_USERINFO_ENDPOINT")),
      endSession: Config.option(Config.URL("OAUTH_END_SESSION_ENDPOINT")),
    }),
    tokenEndpointAuthMethod: Config.option(
      Config.Literals(
        ["client_secret_basic", "client_secret_post"],
        "OAUTH_TOKEN_AUTH_METHOD",
      ),
    ),
    claims: Config.all({
      subject: Config.String("OAUTH_CLAIM_SUBJECT").pipe(
        Config.withDefault("sub"),
      ),
      email: Config.String("OAUTH_CLAIM_EMAIL").pipe(
        Config.withDefault("email"),
      ),
      name: Config.String("OAUTH_CLAIM_NAME").pipe(Config.withDefault("name")),
    }),
    allowedDomains: Config.String("OAUTH_ALLOWED_DOMAINS").pipe(
      Config.withDefault(""),
      Config.map((domains) =>
        domains
          .split(/[\s,]+/)
          .map((domain) => domain.trim().toLowerCase())
          .filter((domain) => domain.length > 0),
      ),
    ),
    allowInsecureRequests: Config.Boolean("OAUTH_ALLOW_INSECURE_REQUESTS").pipe(
      Config.withDefault(false),
    ),
    postLogoutRedirectUri: Config.option(
      Config.URL("OAUTH_POST_LOGOUT_REDIRECT_URI"),
    ),
    sessionTtl: Config.Duration("AUTH_SESSION_TTL").pipe(
      Config.withDefault(Duration.days(7)),
    ),
  });

  static readonly layer = Layer.effect(
    OAuthConfig,
    Effect.gen(function* () {
      return OAuthConfig.of(yield* OAuthConfig.config);
    }),
  );
}
