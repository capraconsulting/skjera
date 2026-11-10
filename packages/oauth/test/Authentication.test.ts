import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Option, Schema } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/http-api";
import { Authentication, CurrentUser } from "../src/Authentication.ts";
import { AuthenticationLive, Authenticator } from "../src/AuthRoutes.ts";
import { Identity } from "../src/Identity.ts";

const origin = "https://pr-2.skjera.capraconsulting.no";
const identity = new Identity({
  issuer: `${origin}/dex`,
  subject: "preview",
  email: "preview@example.com",
});
class Protected extends HttpApiGroup.make("protected")
  .add(HttpApiEndpoint.get("read", "/test", { success: Schema.String }))
  .add(HttpApiEndpoint.post("post", "/test", { success: Schema.String }))
  .add(HttpApiEndpoint.put("put", "/test", { success: Schema.String }))
  .add(HttpApiEndpoint.patch("patch", "/test", { success: Schema.String }))
  .add(HttpApiEndpoint.delete("delete", "/test", { success: Schema.String }))
  .middleware(Authentication) {}
class Api extends HttpApi.make("origin-test").add(Protected) {}

const request = async (
  method: string,
  source?: string,
  authenticated = true,
) => {
  let calls = 0;
  const result = Effect.map(CurrentUser, (user) => {
    calls++;
    return user.email ?? "signed-in";
  });
  const handlers = HttpApiBuilder.group(Api, "protected", (routes) =>
    routes
      .handle("read", () => result)
      .handle("post", () => result)
      .handle("put", () => result)
      .handle("patch", () => result)
      .handle("delete", () => result),
  );
  const app = HttpApiBuilder.layer(Api).pipe(
    Layer.provide(handlers),
    Layer.provide(
      AuthenticationLive.pipe(
        Layer.provide(
          Layer.succeed(Authenticator, {
            origin,
            fromCookies: () =>
              Effect.succeed(
                authenticated ? Option.some(identity) : Option.none(),
              ),
            fromCookieHeader: () => Effect.succeedNone,
          }),
        ),
      ),
    ),
    Layer.provide(HttpServer.layerServices),
  );
  const { handler, dispose } = HttpRouter.toWebHandler(app, {
    disableLogger: true,
  });
  try {
    const response = await handler(
      new Request(`${origin}/test`, {
        method,
        headers: source === undefined ? {} : { Origin: source },
      }),
    );
    return { status: response.status, calls };
  } finally {
    await dispose();
  }
};

describe("cookie-authenticated API origins", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    it(`${method} rejects foreign, sibling-preview and null origins before running the handler`, async () => {
      for (const source of [
        "https://attacker.invalid",
        "https://pr-3.skjera.capraconsulting.no",
        "null",
      ]) {
        assert.deepStrictEqual(await request(method, source), {
          status: 403,
          calls: 0,
        });
      }
    });
    it(`${method} allows the configured origin and non-browser clients without an Origin header`, async () => {
      for (const source of [origin, undefined]) {
        assert.deepStrictEqual(await request(method, source), {
          status: 200,
          calls: 1,
        });
      }
    });
  }
  it("still requires authentication and allows authenticated safe reads", async () => {
    assert.deepStrictEqual(await request("POST", origin, false), {
      status: 401,
      calls: 0,
    });
    assert.deepStrictEqual(await request("GET", "https://attacker.invalid"), {
      status: 200,
      calls: 1,
    });
  });
});
