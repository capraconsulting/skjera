import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { Config, Effect, Layer, Option } from "effect";
import {
  Email,
  EmailRejected,
  EmailThrottled,
  EmailUnavailable,
  envelope,
  toMime,
} from "./Email.ts";

// Email through Amazon SES (v2), on AWS's own client: it finds credentials
// as AWS does (environment, profiles, IAM roles), and keeps them fresh. Its
// retries are off; callers decide, with `retryTransient`.

const throttled = new Set([
  "TooManyRequestsException",
  "LimitExceededException",
  "ThrottlingException",
]);

const rejected = new Set([
  "MessageRejected",
  "MailFromDomainNotVerifiedException",
  "BadRequestException",
  "AccountSuspendedException",
  "SendingPausedException",
  "NotFoundException",
]);

const toError = (error: unknown) => {
  const name = (error as { name?: unknown }).name;
  const reason = `${String(name)}: ${error instanceof Error ? error.message : String(error)}`;
  if (typeof name === "string" && throttled.has(name)) {
    return new EmailThrottled({ reason });
  }
  if (typeof name === "string" && rejected.has(name)) {
    return new EmailRejected({ reason });
  }
  return new EmailUnavailable({ reason });
};

export interface SesOptions {
  /** The AWS region, e.g. "eu-north-1"; else as AWS finds it. */
  readonly region?: string;
  /** Records sends, bounces and complaints, as set up in SES. */
  readonly configurationSet?: string;
  /** Another endpoint than AWS's, e.g. for tests. */
  readonly endpoint?: string;
  /** Else as AWS finds them. */
  readonly credentials?: {
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
}

export const makeSes = (options: SesOptions = {}) => {
  const client = new SESv2Client({
    maxAttempts: 1,
    ...(options.region === undefined ? {} : { region: options.region }),
    ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
    ...(options.credentials === undefined
      ? {}
      : { credentials: options.credentials }),
  });
  return Email.of({
    send: (message) =>
      Effect.gen(function* () {
        const mime = yield* toMime(message);
        const to = envelope(message);
        const sent = yield* Effect.tryPromise({
          try: (signal) =>
            client.send(
              new SendEmailCommand({
                FromEmailAddress: to.from,
                Destination: {
                  ToAddresses: to.to,
                  CcAddresses: to.cc,
                  BccAddresses: to.bcc,
                },
                Content: { Raw: { Data: mime } },
                ...(options.configurationSet === undefined
                  ? {}
                  : { ConfigurationSetName: options.configurationSet }),
              }),
              { abortSignal: signal },
            ),
          catch: toError,
        });
        if (sent.MessageId === undefined) {
          return yield* Effect.die("SES sent a message without its id");
        }
        return { id: sent.MessageId };
      }),
  });
};

export const layerSes = (options?: SesOptions) =>
  Layer.succeed(Email, makeSes(options));

/**
 * With `AWS_REGION` (and credentials) as AWS finds them, and
 * `SES_CONFIGURATION_SET` if set.
 */
export const layerSesConfig = Layer.unwrap(
  Effect.gen(function* () {
    const region = yield* Config.option(Config.String("AWS_REGION"));
    const configurationSet = yield* Config.option(
      Config.String("SES_CONFIGURATION_SET"),
    );
    return layerSes({
      ...Option.match(region, {
        onNone: () => ({}),
        onSome: (region) => ({ region }),
      }),
      ...Option.match(configurationSet, {
        onNone: () => ({}),
        onSome: (configurationSet) => ({ configurationSet }),
      }),
    });
  }),
);
