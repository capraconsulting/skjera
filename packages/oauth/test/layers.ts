import { ConfigProvider, Layer } from "effect";
import { OAuthConfig } from "../src/OAuthConfig.ts";

export const configLayer = (env: Record<string, string> = {}) =>
  OAuthConfig.layer.pipe(
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          OAUTH_ISSUER: "https://idp.example",
          OAUTH_CLIENT_ID: "client",
          OAUTH_CLIENT_SECRET: "secret",
          OAUTH_REDIRECT_URI: "https://app.example/auth/callback",
          ...env,
        }),
      ),
    ),
  );
