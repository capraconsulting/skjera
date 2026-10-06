import { Config, Effect, Layer } from "effect";
import { layerSesConfig } from "./ses.ts";
import { layerSmtpConfig } from "./smtp.ts";

export * from "./Email.ts";
export * from "./ses.ts";
export * from "./smtp.ts";

/**
 * Email as configured: `EMAIL_TRANSPORT` "ses" (the default; see
 * `layerSesConfig`) or "smtp" (see `layerSmtpConfig`).
 */
export const layerConfig = Layer.unwrap(
  Effect.map(
    Config.Literals(["ses", "smtp"], "EMAIL_TRANSPORT").pipe(
      Config.withDefault("ses" as const),
    ),
    (transport) => (transport === "smtp" ? layerSmtpConfig : layerSesConfig),
  ),
);
