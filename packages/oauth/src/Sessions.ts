import { createHash, randomBytes } from "node:crypto";
import {
  Clock,
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Option,
  Schema,
} from "effect";
import { KeyValueStore } from "effect/persistence";
import { Identity } from "./Identity.ts";
import type { LoginChallenge, Tokens } from "./OAuthClient.ts";
import { OAuthConfig } from "./OAuthConfig.ts";

/** How long a user has to finish logging in at the provider. */
export const loginAttemptTtl = Duration.minutes(10);

export class SessionStoreError extends Data.TaggedError("SessionStoreError")<{
  readonly cause: unknown;
}> {}

export class LoginAttempt extends Schema.Class<LoginAttempt>(
  "@skjera/oauth/LoginAttempt",
)({
  state: Schema.String,
  codeVerifier: Schema.String,
  nonce: Schema.optional(Schema.String),
  returnTo: Schema.String,
  expiresAt: Schema.Number,
}) {}

export class Session extends Schema.Class<Session>("@skjera/oauth/Session")({
  identity: Identity,
  accessToken: Schema.Redacted(Schema.String),
  refreshToken: Schema.optional(Schema.Redacted(Schema.String)),
  idToken: Schema.optional(Schema.String),
  accessTokenExpiresAt: Schema.optional(Schema.Number),
  expiresAt: Schema.Number,
}) {}

/**
 * Server-side storage for sessions and in-flight logins, on top of any
 * `KeyValueStore`. The browser only ever holds a random id; the store is keyed
 * by its SHA-256 hash so a leaked store can't be used to hijack sessions.
 */
export class Sessions extends Context.Service<
  Sessions,
  {
    readonly startLogin: (
      challenge: LoginChallenge & { readonly returnTo: string },
    ) => Effect.Effect<string, SessionStoreError>;
    /** Returns the attempt at most once, so a callback can't be replayed. */
    readonly takeLogin: (
      id: string,
    ) => Effect.Effect<Option.Option<LoginAttempt>, SessionStoreError>;
    readonly create: (
      identity: Identity,
      tokens: Tokens,
    ) => Effect.Effect<string, SessionStoreError>;
    readonly get: (
      id: string,
    ) => Effect.Effect<Option.Option<Session>, SessionStoreError>;
    readonly remove: (id: string) => Effect.Effect<void, SessionStoreError>;
  }
>()("@skjera/oauth/Sessions") {
  static readonly layer = Layer.effect(
    Sessions,
    Effect.gen(function* () {
      const config = yield* OAuthConfig;
      const store = yield* KeyValueStore.KeyValueStore;
      const logins = KeyValueStore.toSchemaStore(
        KeyValueStore.prefix(store, "oauth/login/"),
        LoginAttempt,
      );
      const sessions = KeyValueStore.toSchemaStore(
        KeyValueStore.prefix(store, "oauth/session/"),
        Session,
      );

      const newId = () => randomBytes(32).toString("base64url");
      const key = (id: string) =>
        createHash("sha256").update(id).digest("base64url");
      const storeError = (cause: unknown) => new SessionStoreError({ cause });

      // Expired entries are dropped when read. A persistent store should also
      // sweep them periodically.
      const getUnexpired = <A extends { readonly expiresAt: number }>(
        get: Effect.Effect<Option.Option<A>, unknown>,
        remove: Effect.Effect<void, unknown>,
      ) =>
        Effect.gen(function* () {
          const value = yield* get;
          const now = yield* Clock.currentTimeMillis;
          if (Option.isSome(value) && value.value.expiresAt <= now) {
            yield* remove;
            return Option.none<A>();
          }
          return value;
        });

      const startLogin = Effect.fn("Sessions.startLogin")(function* (
        challenge: LoginChallenge & { readonly returnTo: string },
      ) {
        const id = newId();
        const now = yield* Clock.currentTimeMillis;
        yield* logins.set(
          key(id),
          new LoginAttempt({
            state: challenge.state,
            codeVerifier: challenge.codeVerifier,
            nonce: challenge.nonce,
            returnTo: challenge.returnTo,
            expiresAt: now + Duration.toMillis(loginAttemptTtl),
          }),
        );
        return id;
      }, Effect.mapError(storeError));

      const takeLogin = Effect.fn("Sessions.takeLogin")(function* (id: string) {
        const remove = logins.remove(key(id));
        const attempt = yield* getUnexpired(logins.get(key(id)), remove);
        yield* remove;
        return attempt;
      }, Effect.mapError(storeError));

      const create = Effect.fn("Sessions.create")(function* (
        identity: Identity,
        tokens: Tokens,
      ) {
        const id = newId();
        const now = yield* Clock.currentTimeMillis;
        yield* sessions.set(
          key(id),
          new Session({
            identity,
            accessToken: tokens.accessToken,
            refreshToken: Option.getOrUndefined(tokens.refreshToken),
            idToken: Option.getOrUndefined(tokens.idToken),
            accessTokenExpiresAt: Option.getOrUndefined(tokens.expiresAt),
            expiresAt: now + Duration.toMillis(config.sessionTtl),
          }),
        );
        return id;
      }, Effect.mapError(storeError));

      const get = (id: string) =>
        getUnexpired(sessions.get(key(id)), sessions.remove(key(id))).pipe(
          Effect.mapError(storeError),
          Effect.withSpan("Sessions.get"),
        );

      const remove = (id: string) =>
        sessions
          .remove(key(id))
          .pipe(
            Effect.mapError(storeError),
            Effect.withSpan("Sessions.remove"),
          );

      return Sessions.of({ startLogin, takeLogin, create, get, remove });
    }),
  );
}
