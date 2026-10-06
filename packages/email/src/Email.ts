import { Context, Duration, Effect, Schema } from "effect";
import MailComposer from "nodemailer/lib/mail-composer/index.js";

// Sending email, whatever sends it. A message is built into MIME here, once,
// the same for every transport: so calendar invitations, attachments and
// alternatives come out alike from SES (raw email) and SMTP.

/** "alice@example.com", or with a name to show. */
export type Address =
  | string
  | { readonly name: string; readonly address: string };

export interface Attachment {
  readonly filename: string;
  readonly content: string | Uint8Array;
  readonly contentType: string;
}

export interface Message {
  readonly from: Address;
  readonly to: Address | ReadonlyArray<Address>;
  readonly cc?: Address | ReadonlyArray<Address>;
  /** Kept out of the message's headers; only sent to. */
  readonly bcc?: Address | ReadonlyArray<Address>;
  readonly replyTo?: Address;
  readonly subject: string;
  /** The plain text version, for clients that don't show HTML. */
  readonly text: string;
  readonly html?: string;
  readonly attachments?: ReadonlyArray<Attachment>;
  /**
   * An iCalendar invitation (or its cancellation), which mail clients offer
   * to put in calendars: `method` must match the calendar's own METHOD.
   */
  readonly calendar?: {
    readonly method: "REQUEST" | "CANCEL" | "PUBLISH";
    readonly content: string;
  };
  readonly headers?: Readonly<Record<string, string>>;
}

/** The provider's id for a message sent. */
export interface Sent {
  readonly id: string;
}

/**
 * The provider won't send it: an address or sender it refuses, an
 * unverified domain, a paused account. Retrying won't help.
 */
export class EmailRejected extends Schema.TaggedError<EmailRejected>()(
  "EmailRejected",
  { reason: Schema.String },
) {}

/** Sending too fast, or the day's quota is used: try again later. */
export class EmailThrottled extends Schema.TaggedError<EmailThrottled>()(
  "EmailThrottled",
  { reason: Schema.String },
) {}

/** The provider couldn't be reached, or failed for now: try again. */
export class EmailUnavailable extends Schema.TaggedError<EmailUnavailable>()(
  "EmailUnavailable",
  { reason: Schema.String },
) {}

export type EmailError = EmailRejected | EmailThrottled | EmailUnavailable;

export class Email extends Context.Service<
  Email,
  {
    readonly send: (message: Message) => Effect.Effect<Sent, EmailError>;
  }
>()("@skjera/email/Email") {}

const list = (addresses: Address | ReadonlyArray<Address> | undefined) =>
  addresses === undefined
    ? []
    : typeof addresses === "string" || !Array.isArray(addresses)
      ? [addresses as Address]
      : (addresses as ReadonlyArray<Address>);

const plain = (address: Address) =>
  typeof address === "string" ? address : address.address;

/** Who it goes to, as transports need it: plain addresses. */
export const envelope = (message: Message) => ({
  from: plain(message.from),
  to: list(message.to).map(plain),
  cc: list(message.cc).map(plain),
  bcc: list(message.bcc).map(plain),
});

/** The message as MIME, to send as it is. */
export const toMime = (message: Message): Effect.Effect<Uint8Array> =>
  Effect.promise(() =>
    new MailComposer({
      from: message.from,
      to: [...list(message.to)],
      cc: [...list(message.cc)],
      bcc: [...list(message.bcc)],
      ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
      subject: message.subject,
      text: message.text,
      ...(message.html === undefined ? {} : { html: message.html }),
      attachments: (message.attachments ?? []).map((attachment) => ({
        filename: attachment.filename,
        content:
          typeof attachment.content === "string"
            ? attachment.content
            : Buffer.from(attachment.content),
        contentType: attachment.contentType,
      })),
      ...(message.calendar === undefined
        ? {}
        : {
            icalEvent: {
              method: message.calendar.method,
              content: message.calendar.content,
            },
          }),
      ...(message.headers === undefined ? {} : { headers: message.headers }),
    })
      .compile()
      .build(),
  ).pipe(Effect.map((mime) => new Uint8Array(mime)));

/**
 * Tries again what may work later: when throttled or unavailable, after 1,
 * 2, 4, … seconds (from `base`, at most a minute). At most `times` more
 * tries; a rejection isn't retried.
 */
export const retryTransient =
  (options: { readonly times?: number; readonly base?: Duration.Input } = {}) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
    const times = options.times ?? 5;
    const base = Duration.fromInputUnsafe(options.base ?? "1 second");
    const attempt = (n: number): Effect.Effect<A, E, R> =>
      self.pipe(
        Effect.catchIf(
          (error): error is E & (EmailThrottled | EmailUnavailable) =>
            n < times &&
            (error instanceof EmailThrottled ||
              error instanceof EmailUnavailable),
          () =>
            Effect.sleep(
              Duration.min(Duration.times(base, 2 ** n), Duration.minutes(1)),
            ).pipe(Effect.andThen(Effect.suspend(() => attempt(n + 1)))),
        ),
      );
    return attempt(0);
  };
