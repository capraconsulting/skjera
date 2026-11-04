import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { SiteConfig } from "../Model.ts";

// The web app manifest (`GET /manifest.webmanifest`), as Skjer serves it: what
// a phone is told when the site is added to its home screen.

export const path = "/manifest.webmanifest";

/** The manifest of the site called `name`. */
export const manifest = (name: string) => ({
  name,
  short_name: name,
  start_url: "/",
  display: "standalone",
  theme_color: "#000000",
  background_color: "#ffffff",
  icons: [
    {
      src: "/favicon.ico",
      sizes: "16x16 32x32 48x48 64x64",
      type: "image/x-icon",
    },
  ],
});

/**
 * `GET /manifest.webmanifest`: the manifest of the site called `SITE_NAME`,
 * read when the server starts.
 */
export const layerHttp = Layer.unwrap(
  Effect.gen(function* () {
    const { name } = yield* SiteConfig;
    const body = JSON.stringify(manifest(name));
    return HttpRouter.add(
      "GET",
      path,
      Effect.succeed(
        HttpServerResponse.text(body, {
          contentType: "application/manifest+json",
          headers: { "Cache-Control": "no-cache" },
        }),
      ),
    );
  }),
);
