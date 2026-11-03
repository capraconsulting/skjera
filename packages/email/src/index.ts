import { Config, Effect, Layer, Option, type Redacted } from "effect";
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

/** How emails leave the server, as configured. */
export type Transport =
  | { readonly kind: "none"; readonly why: string }
  | { readonly kind: "ses" }
  | { readonly kind: "smtp"; readonly url: Redacted.Redacted<string> };

/**
 * The transport configured: none without `EMAIL_TRANSPORT`, or with smtp and
 * no `EMAIL_SMTP_URL`.
 */
export const transport = Config.all({
  kind: Config.option(Config.Literals(["ses", "smtp"], "EMAIL_TRANSPORT")),
  url: Config.option(Config.Redacted("EMAIL_SMTP_URL")),
}).pipe(
  Config.map(({ kind, url }): Transport => {
    if (Option.isNone(kind)) {
      return { kind: "none", why: "EMAIL_TRANSPORT not set" };
    }
    if (kind.value === "ses") return { kind: "ses" };
    return Option.isNone(url)
      ? { kind: "none", why: "EMAIL_SMTP_URL not set" }
      : { kind: "smtp", url: url.value };
  }),
);

/** Emails leave the server: a transport is configured. */
export const sendsEmail = transport.pipe(
  Config.map((configured) => configured.kind !== "none"),
);

/**
 * Email as configured: `EMAIL_TRANSPORT` "ses" (see `layerSesConfig`) or
 * "smtp" (to `EMAIL_SMTP_URL`). Without them, emails are logged instead,
 * with a warning, so the rest still runs.
 */
export const layerConfig = Layer.unwrap(
  Effect.gen(function* () {
    const configured = yield* transport;
    switch (configured.kind) {
      case "none":
        return notSending(configured.why);
      case "ses":
        return layerSesConfig;
      case "smtp":
        return layerSmtp(configured.url);
    }
  }),
);
