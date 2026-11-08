import { createHash } from "node:crypto";
import { assert, describe, it } from "@effect/vitest";
import { Duration, Effect, Layer, Option, Redacted } from "effect";
import { KeyValueStore } from "effect/persistence";
import { TestClock } from "effect/testing";
import { Identity } from "../src/Identity.ts";
import { Sessions } from "../src/Sessions.ts";
import { configLayer } from "./layers.ts";

const SessionsTest = Sessions.layer.pipe(
  Layer.provideMerge(KeyValueStore.layerMemory),
  Layer.provide(configLayer({ AUTH_SESSION_TTL: "1 hour" })),
);

const identity = new Identity({
  issuer: "https://idp.example",
  subject: "alice",
  email: "alice@example.com",
});
const tokens = {
  accessToken: Redacted.make("access"),
  refreshToken: Option.some(Redacted.make("refresh")),
  idToken: Option.none(),
  expiresAt: Option.none(),
};
const storedKey = (kind: "login" | "session", id: string) =>
  `oauth/${kind}/${createHash("sha256").update(id).digest("base64url")}`;

describe("Sessions", () => {
  it.effect("removes sessions that predate the expiration index (AC-1)", () =>
    Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      yield* store.set("oauth/session/legacy", "an old encoded session");

      yield* Effect.gen(function* () {
        yield* Sessions;
        assert.isFalse(yield* store.has("oauth/session/legacy"));
      }).pipe(Effect.provide(Sessions.layer));
    }).pipe(
      Effect.provide(KeyValueStore.layerMemory),
      Effect.provide(configLayer({ AUTH_SESSION_TTL: "1 hour" })),
    ),
  );

  it.effect(
    "keeps every concurrent session scheduled for deletion (AC-1)",
    () =>
      Effect.gen(function* () {
        const backing = yield* KeyValueStore.KeyValueStore;
        let delayExpirationReads = false;
        const racing = KeyValueStore.make({
          ...backing,
          get: (key) =>
            backing
              .get(key)
              .pipe(
                Effect.tap(() =>
                  delayExpirationReads && key === "oauth/expirations"
                    ? Effect.yieldNow
                    : Effect.void,
                ),
              ),
        });

        yield* Effect.gen(function* () {
          const sessions = yield* Sessions;
          delayExpirationReads = true;
          const ids = yield* Effect.all(
            Array.from({ length: 20 }, () => sessions.create(identity, tokens)),
            { concurrency: "unbounded" },
          );

          yield* TestClock.adjust(Duration.days(1));
          for (const id of ids) {
            assert.isFalse(yield* backing.has(storedKey("session", id)));
          }
        }).pipe(
          Effect.provide(Sessions.layer),
          Effect.provide(Layer.succeed(KeyValueStore.KeyValueStore, racing)),
        );
      }).pipe(
        Effect.provide(KeyValueStore.layerMemory),
        Effect.provide(configLayer({ AUTH_SESSION_TTL: "1 hour" })),
      ),
  );

  it.effect("retries cleanup after a store failure (AC-1)", () =>
    Effect.gen(function* () {
      const backing = yield* KeyValueStore.KeyValueStore;
      let failNextRemoval = true;
      const flaky = KeyValueStore.make({
        ...backing,
        remove: (key) => {
          if (failNextRemoval && key.startsWith("oauth/session/")) {
            failNextRemoval = false;
            return Effect.fail(
              new KeyValueStore.KeyValueStoreError({
                method: "remove",
                key,
                message: "temporary failure",
              }),
            );
          }
          return backing.remove(key);
        },
      });

      yield* Effect.gen(function* () {
        const sessions = yield* Sessions;
        const id = yield* sessions.create(identity, tokens);
        yield* TestClock.adjust(Duration.days(1));
        assert.isTrue(yield* backing.has(storedKey("session", id)));
        yield* TestClock.adjust(Duration.minutes(1));
        assert.isFalse(yield* backing.has(storedKey("session", id)));
      }).pipe(
        Effect.provide(Sessions.layer),
        Effect.provide(Layer.succeed(KeyValueStore.KeyValueStore, flaky)),
      );
    }).pipe(
      Effect.provide(KeyValueStore.layerMemory),
      Effect.provide(configLayer({ AUTH_SESSION_TTL: "1 hour" })),
    ),
  );

  it.effect("deletes expired logins and sessions on schedule (AC-1)", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      const store = yield* KeyValueStore.KeyValueStore;
      const loginId = yield* sessions.startLogin({
        state: "s",
        codeVerifier: "v",
        returnTo: "/",
      });
      const sessionId = yield* sessions.create(identity, tokens);

      yield* TestClock.adjust(Duration.days(1));
      assert.isFalse(yield* store.has(storedKey("login", loginId)));
      assert.isFalse(yield* store.has(storedKey("session", sessionId)));
    }).pipe(Effect.provide(SessionsTest)),
  );

  it.effect("stores no access token or refresh token (AC-2)", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      const id = yield* sessions.create(identity, tokens);

      const stored = JSON.stringify(Option.getOrThrow(yield* sessions.get(id)));
      assert.notInclude(stored, "accessToken");
      assert.notInclude(stored, "refreshToken");
    }).pipe(Effect.provide(SessionsTest)),
  );

  it.effect("stores sessions until they expire", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      const id = yield* sessions.create(identity, tokens);

      const session = yield* sessions.get(id);
      assert.isTrue(Option.isSome(session));
      assert.deepStrictEqual(Option.getOrThrow(session).identity, identity);

      yield* TestClock.adjust(Duration.hours(1));
      assert.isTrue(Option.isNone(yield* sessions.get(id)));
    }).pipe(Effect.provide(SessionsTest)),
  );

  it.effect("keys the store by a hash, never the raw session id", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      const store = yield* KeyValueStore.KeyValueStore;
      const id = yield* sessions.create(identity, tokens);
      assert.isFalse(yield* store.has(`oauth/session/${id}`));
      assert.isTrue(yield* store.has(storedKey("session", id)));
    }).pipe(Effect.provide(SessionsTest)),
  );

  it.effect("removes sessions", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      const id = yield* sessions.create(identity, tokens);
      yield* sessions.remove(id);
      assert.isTrue(Option.isNone(yield* sessions.get(id)));
    }).pipe(Effect.provide(SessionsTest)),
  );

  it.effect("hands out a login attempt only once", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      const id = yield* sessions.startLogin({
        state: "s",
        codeVerifier: "v",
        nonce: "n",
        returnTo: "/x",
      });

      const attempt = yield* sessions.takeLogin(id);
      assert.strictEqual(Option.getOrThrow(attempt).returnTo, "/x");
      assert.isTrue(Option.isNone(yield* sessions.takeLogin(id)));
    }).pipe(Effect.provide(SessionsTest)),
  );

  it.effect("expires login attempts after ten minutes", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      const id = yield* sessions.startLogin({
        state: "s",
        codeVerifier: "v",
        returnTo: "/",
      });
      yield* TestClock.adjust(Duration.minutes(10));
      assert.isTrue(Option.isNone(yield* sessions.takeLogin(id)));
    }).pipe(Effect.provide(SessionsTest)),
  );
});
