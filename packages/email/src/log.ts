import { Effect, Layer } from "effect";
import { Email, envelope } from "./Email.ts";

// Email that isn't sent, only logged: when none is configured, so the rest
// still works.

export const makeLog = () => {
  let count = 0;
  return Email.of({
    send: (message) =>
      Effect.gen(function* () {
        const id = `log-${++count}`;
        yield* Effect.logInfo("Email not sent (no transport configured)", {
          to: envelope(message).to,
          subject: message.subject,
        });
        return { id };
      }),
  });
};

export const layerLog = Layer.sync(Email, makeLog);
