import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  HttpClient,
  type HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
import { OAuthClient } from "../src/OAuthClient.ts";
import { configLayer } from "./layers.ts";

// A plain OAuth 2.0 provider without discovery or ID tokens, shaped like
// GitHub: identity comes from a userinfo endpoint with a numeric `id`.
const requests: Array<{
  url: URL;
  request: HttpClientRequest.HttpClientRequest;
}> = [];

const json = (request: HttpClientRequest.HttpClientRequest, body: unknown) =>
  HttpClientResponse.fromWeb(
    request,
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

const ProviderStub = Layer.succeed(HttpClient.HttpClient)(
  HttpClient.make((request, url) => {
    requests.push({ url, request });
    switch (url.pathname) {
      case "/token":
        return Effect.succeed(
          json(request, {
            access_token: "gho_token",
            token_type: "bearer",
            expires_in: 3600,
          }),
        );
      case "/user":
        return Effect.succeed(
          json(request, {
            id: 42,
            login: "octocat",
            email: "octo@example.com",
          }),
        );
      default:
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(null, { status: 404 }),
          ),
        );
    }
  }),
);

const ClientTest = OAuthClient.layer.pipe(
  Layer.provide(ProviderStub),
  Layer.provide(
    configLayer({
      OAUTH_ISSUER: "https://provider.example",
      OAUTH_AUTHORIZATION_ENDPOINT: "https://provider.example/authorize",
      OAUTH_TOKEN_ENDPOINT: "https://provider.example/token",
      OAUTH_USERINFO_ENDPOINT: "https://provider.example/user",
      OAUTH_SCOPES: "read:user user:email",
      OAUTH_TOKEN_AUTH_METHOD: "client_secret_post",
      OAUTH_CLAIM_SUBJECT: "id",
      OAUTH_CLAIM_NAME: "login",
    }),
  ),
);

const bodyOf = (request: HttpClientRequest.HttpClientRequest) =>
  new URLSearchParams(
    request.body._tag === "Uint8Array"
      ? new TextDecoder().decode(request.body.body)
      : "",
  );

describe("OAuthClient with a plain OAuth 2.0 provider", () => {
  it.effect("builds a PKCE authorization URL without a nonce", () =>
    Effect.gen(function* () {
      const client = yield* OAuthClient;
      const { url, challenge } = yield* client.startLogin;

      assert.strictEqual(
        url.origin + url.pathname,
        "https://provider.example/authorize",
      );
      assert.strictEqual(url.searchParams.get("state"), challenge.state);
      assert.strictEqual(url.searchParams.get("code_challenge_method"), "S256");
      assert.strictEqual(url.searchParams.get("scope"), "read:user user:email");
      assert.isNull(url.searchParams.get("nonce"));
    }).pipe(Effect.provide(ClientTest)),
  );

  it.effect("exchanges the code and reads the identity from userinfo", () =>
    Effect.gen(function* () {
      requests.length = 0;
      const client = yield* OAuthClient;
      const { challenge } = yield* client.startLogin;
      const callback = new URL(
        `https://app.example/auth/callback?code=abc&state=${challenge.state}`,
      );

      const { identity } = yield* client.completeLogin(callback, challenge);
      assert.deepStrictEqual(
        { ...identity },
        {
          issuer: "https://provider.example",
          subject: "42",
          email: "octo@example.com",
          name: "octocat",
        },
      );

      const [tokenRequest, userInfoRequest] = requests;
      assert.isDefined(tokenRequest);
      assert.isDefined(userInfoRequest);
      const token = bodyOf(tokenRequest.request);
      assert.strictEqual(token.get("code"), "abc");
      assert.strictEqual(token.get("code_verifier"), challenge.codeVerifier);
      assert.strictEqual(token.get("client_secret"), "secret");
      assert.strictEqual(
        userInfoRequest.request.headers.authorization,
        "Bearer gho_token",
      );
    }).pipe(Effect.provide(ClientTest)),
  );

  it.effect("rejects a callback with the wrong state", () =>
    Effect.gen(function* () {
      const client = yield* OAuthClient;
      const { challenge } = yield* client.startLogin;
      const callback = new URL(
        "https://app.example/auth/callback?code=abc&state=forged",
      );

      const error = yield* Effect.flip(
        client.completeLogin(callback, challenge),
      );
      assert.strictEqual(error._tag, "OAuthError");
    }).pipe(Effect.provide(ClientTest)),
  );

  it.effect("reports errors returned by the provider", () =>
    Effect.gen(function* () {
      const client = yield* OAuthClient;
      const { challenge } = yield* client.startLogin;
      const callback = new URL(
        `https://app.example/auth/callback?error=access_denied&state=${challenge.state}`,
      );

      const error = yield* Effect.flip(
        client.completeLogin(callback, challenge),
      );
      assert.include(error.message, "access_denied");
    }).pipe(Effect.provide(ClientTest)),
  );
});
