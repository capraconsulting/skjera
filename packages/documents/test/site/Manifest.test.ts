import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import * as Manifest from "../../src/site/Manifest.ts";

// The web app manifest: what a phone is told when the site is added to its
// home screen.

interface Served {
  readonly name: string;
  readonly short_name: string;
  readonly start_url: string;
  readonly display: string;
  readonly theme_color: string;
  readonly background_color: string;
  readonly icons: ReadonlyArray<{
    readonly src: string;
    readonly sizes: string;
  }>;
}

/** Fetches `path` from the manifest's route, with the configuration `env`. */
const fetched = (env: Record<string, string>, path: string) =>
  Effect.gen(function* () {
    const app = Manifest.layerHttp.pipe(
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(app, {
      disableLogger: true,
    });
    yield* Effect.addFinalizer(() => Effect.promise(dispose));
    return yield* Effect.promise(() =>
      handler(new Request(`http://localhost${path}`)),
    );
  }).pipe(Effect.scoped);

describe("Manifest", () => {
  it.effect(
    "serves the site's name, how it starts, its colours and its icon (AC-2)",
    () =>
      Effect.gen(function* () {
        const response = yield* fetched({ SITE_NAME: "Skjer" }, Manifest.path);
        assert.strictEqual(response.status, 200);
        assert.include(
          response.headers.get("content-type") ?? "",
          "application/manifest+json",
        );
        assert.strictEqual(response.headers.get("cache-control"), "no-cache");
        const body = (yield* Effect.promise(() => response.json())) as Served;
        assert.strictEqual(body.name, "Skjer");
        assert.strictEqual(body.short_name, "Skjer");
        assert.strictEqual(body.start_url, "/");
        assert.strictEqual(body.display, "standalone");
        assert.match(body.theme_color, /^#[0-9a-f]{6}$/i);
        assert.match(body.background_color, /^#[0-9a-f]{6}$/i);
        assert.strictEqual(body.icons[0]?.src, "/favicon.ico");
        assert.isString(body.icons[0]?.sizes);
      }),
  );

  it.effect("names the site Skjera when SITE_NAME is not set (AC-2)", () =>
    Effect.gen(function* () {
      const response = yield* fetched({}, Manifest.path);
      const body = (yield* Effect.promise(() => response.json())) as Served;
      assert.strictEqual(body.name, "Skjera");
    }),
  );

  it("is a plain description of the site, whatever its name (AC-2)", () => {
    assert.strictEqual(Manifest.manifest("A & B").name, "A & B");
    assert.strictEqual(Manifest.path, "/manifest.webmanifest");
  });
});
