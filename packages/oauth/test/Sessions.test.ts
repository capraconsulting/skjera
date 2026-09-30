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

describe("Sessions", () => {
  it.effect("stores sessions until they expire", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      const id = yield* sessions.create(identity, tokens);

      const session = yield* sessions.get(id);
      assert.isTrue(Option.isSome(session));
      assert.deepStrictEqual(Option.getOrThrow(session).identity, identity);
      assert.strictEqual(
        Redacted.value(Option.getOrThrow(session).accessToken),
        "access",
      );

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
      assert.strictEqual(yield* store.size, 1);
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
