import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  HttpClient,
  type HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
import { OAuthClient } from "../src/OAuthClient.ts";
import { configLayer } from "./layers.ts";

// Claims returned by the stubbed userinfo endpoint for the current test.
let userInfo: Record<string, unknown> = {};

const json = (request: HttpClientRequest.HttpClientRequest, body: unknown) =>
  HttpClientResponse.fromWeb(
    request,
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

const ProviderStub = Layer.succeed(HttpClient.HttpClient)(
  HttpClient.make((request, url) =>
    Effect.succeed(
      url.pathname === "/token"
        ? json(request, { access_token: "token", token_type: "bearer" })
        : json(request, userInfo),
    ),
  ),
);

// Shaped like Google, but served by the stub so no ID token is involved.
const GoogleLike = OAuthClient.layer.pipe(
  Layer.provide(ProviderStub),
  Layer.provide(
    configLayer({
      OAUTH_ISSUER: "https://accounts.google.com",
      OAUTH_AUTHORIZATION_ENDPOINT: "https://idp.example/authorize",
      OAUTH_TOKEN_ENDPOINT: "https://idp.example/token",
      OAUTH_USERINFO_ENDPOINT: "https://idp.example/userinfo",
      OAUTH_SCOPES: "email profile",
      OAUTH_ALLOWED_DOMAINS: "Example.com",
    }),
  ),
);

const login = (claims: Record<string, unknown>) =>
  Effect.gen(function* () {
    userInfo = claims;
    const client = yield* OAuthClient;
    const { challenge } = yield* client.startLogin;
    return yield* client.completeLogin(
      new URL(
        `https://app.example/auth/callback?code=abc&state=${challenge.state}`,
      ),
      challenge,
    );
  });

describe("OAuthClient with allowed domains", () => {
  it.effect("hints the domain to Google's account picker", () =>
    Effect.gen(function* () {
      const client = yield* OAuthClient;
      const { url } = yield* client.startLogin;
      assert.strictEqual(url.searchParams.get("hd"), "example.com");
    }).pipe(Effect.provide(GoogleLike)),
  );

  it.effect("lets in accounts from an allowed Workspace", () =>
    Effect.gen(function* () {
      const { identity } = yield* login({
        sub: "1",
        email: "alice@example.com",
        email_verified: true,
        hd: "example.com",
      });
      assert.strictEqual(identity.subject, "1");
    }).pipe(Effect.provide(GoogleLike)),
  );

  it.effect("denies personal Google accounts with a company email", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        login({ sub: "2", email: "mallory@example.com", email_verified: true }),
      );
      assert.strictEqual(error._tag, "AccessDenied");
    }).pipe(Effect.provide(GoogleLike)),
  );

  it.effect("denies other Workspaces", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        login({
          sub: "3",
          email: "eve@other.example",
          email_verified: true,
          hd: "other.example",
        }),
      );
      assert.strictEqual(error._tag, "AccessDenied");
    }).pipe(Effect.provide(GoogleLike)),
  );

  it.effect("gives the picture claim when it is an https address (AC-6)", () =>
    Effect.gen(function* () {
      const picture = "https://lh3.googleusercontent.com/a/x";
      const { identity } = yield* login({
        sub: "4",
        email: "alice@example.com",
        email_verified: true,
        hd: "example.com",
        picture,
      });
      assert.strictEqual(identity.picture, picture);
    }).pipe(Effect.provide(GoogleLike)),
  );

  it.effect("has no picture without the claim, or with one that is not https (AC-6)", () =>
    Effect.gen(function* () {
      for (const picture of [
        undefined,
        "",
        42,
        "http://lh3.googleusercontent.com/a/x",
        "javascript:alert(1)",
        "data:image/png;base64,AAAA",
        "not an address",
      ]) {
        const { identity } = yield* login({
          sub: "5",
          email: "alice@example.com",
          email_verified: true,
          hd: "example.com",
          ...(picture === undefined ? {} : { picture }),
        });
        assert.notProperty(identity, "picture", String(picture));
      }
    }).pipe(Effect.provide(GoogleLike)),
  );
});
