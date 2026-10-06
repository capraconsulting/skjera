import { Config, Effect, Layer, Option } from "effect";
import { layerLog } from "./log.ts";
import { layerSesConfig } from "./ses.ts";
import { layerSmtp } from "./smtp.ts";

export * from "./Email.ts";
export * from "./log.ts";
export * from "./ses.ts";
export * from "./smtp.ts";

/** Logs instead of sending, saying why. */
const notSending = (why: string) =>
  Layer.unwrap(
    Effect.as(
      Effect.logWarning(`${why}: emails are logged, not sent`),
      layerLog,
    ),
  );

/**
 * Email as configured: `EMAIL_TRANSPORT` "ses" (see `layerSesConfig`) or
 * "smtp" (to `EMAIL_SMTP_URL`). Without them, emails are logged instead,
 * with a warning, so the rest still runs.
 */
export const layerConfig = Layer.unwrap(
  Effect.gen(function* () {
    const transport = yield* Config.option(
      Config.Literals(["ses", "smtp"], "EMAIL_TRANSPORT"),
    );
    if (Option.isNone(transport)) return notSending("EMAIL_TRANSPORT not set");
    if (transport.value === "ses") return layerSesConfig;
    const url = yield* Config.option(Config.Redacted("EMAIL_SMTP_URL"));
    return Option.isNone(url)
      ? notSending("EMAIL_SMTP_URL not set")
      : layerSmtp(url.value);
  }),
);
