import { Effect, Layer } from "effect";
import { Email, type EmailError, envelope, type Message } from "./Email.ts";

// An outbox in memory, for testing what sends email: what was sent, to
// whom, and failures on cue.

export interface Outgoing {
  readonly id: string;
  readonly message: Message;
  /** Every recipient: to, cc and bcc. */
  readonly recipients: ReadonlyArray<string>;
}

export const make = () => {
  const sent: Array<Outgoing> = [];
  const failures: Array<EmailError> = [];
  let count = 0;

  const email = Email.of({
    send: (message) =>
      Effect.suspend(() => {
        const failure = failures.shift();
        if (failure !== undefined) return Effect.fail(failure);
        const to = envelope(message);
        const id = `test-${++count}`;
        sent.push({
          id,
          message,
          recipients: [...to.to, ...to.cc, ...to.bcc],
        });
        return Effect.succeed({ id });
      }),
  });

  return {
    email,
    layer: Layer.succeed(Email, email),
    /** What was sent, oldest first. */
    sent: (): ReadonlyArray<Outgoing> => [...sent],
    /** What was sent to `address`. */
    to: (address: string) =>
      sent.filter((each) =>
        each.recipients.some(
          (recipient) => recipient.toLowerCase() === address.toLowerCase(),
        ),
      ),
    /** Makes the next send fail with `error`. */
    failNext: (error: EmailError) => {
      failures.push(error);
    },
  };
};
