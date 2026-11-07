import { Effect, Layer, Redacted } from "effect";
import { createTransport } from "nodemailer";
import {
  Email,
  EmailRejected,
  EmailUnavailable,
  envelope,
  toMime,
} from "./Email.ts";

// Email over SMTP: for local development (Mailpit, in compose.yml) and for
// servers that send through a mail server of their own.

const toError = (error: unknown) => {
  const smtp = error as { responseCode?: unknown; message?: unknown };
  const reason = String(smtp.message ?? error);
  // 5xx: the server won't take it; 4xx, or no answer: try again later.
  return typeof smtp.responseCode === "number" && smtp.responseCode >= 500
    ? new EmailRejected({ reason })
    : new EmailUnavailable({ reason });
};

/** On the SMTP server at `url`, e.g. "smtp://localhost:1025". */
export const makeSmtp = (url: Redacted.Redacted<string>) => {
  const transport = createTransport(Redacted.value(url));
  return Email.of({
    send: (message) =>
      Effect.gen(function* () {
        const raw = yield* toMime(message);
        const to = envelope(message);
        const sent = yield* Effect.tryPromise({
          try: () =>
            transport.sendMail({
              envelope: { from: to.from, to: [...to.to, ...to.cc, ...to.bcc] },
              raw: Buffer.from(raw),
            }),
          catch: toError,
        });
        return { id: sent.messageId };
      }),
  });
};

export const layerSmtp = (url: Redacted.Redacted<string>) =>
  Layer.succeed(Email, makeSmtp(url));
