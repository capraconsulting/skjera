import type { Block, KnownBlock } from "@slack/types";
import { ErrorCode, LogLevel, WebClient } from "@slack/web-api";
import {
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";

// The parts of Slack's Web API we use, as an Effect service, on Slack's own
// client (@slack/web-api). Its retries are off: callers decide, with
// `retryTransient`, so a rate-limited call doesn't hold up others unseen.

/**
 * Slack said no: `ok: false` with an error code, e.g. "not_in_channel",
 * "channel_not_found", "invalid_auth". Retrying won't help.
 */
export class SlackApiError extends Schema.TaggedError<SlackApiError>()(
  "SlackApiError",
  { method: Schema.String, code: Schema.String },
) {}

/** Too many calls: try again after `retryAfter` seconds. */
export class SlackRateLimited extends Schema.TaggedError<SlackRateLimited>()(
  "SlackRateLimited",
  { method: Schema.String, retryAfter: Schema.Number },
) {}

/** Slack couldn't be reached, or failed (an HTTP error): try again. */
export class SlackUnavailable extends Schema.TaggedError<SlackUnavailable>()(
  "SlackUnavailable",
  {
    method: Schema.String,
    message: Schema.String,
    status: Schema.optionalKey(Schema.Number),
  },
) {}

export type SlackError = SlackApiError | SlackRateLimited | SlackUnavailable;

/** Block Kit blocks, as Slack's own types have them. */
export type Blocks = ReadonlyArray<KnownBlock | Block>;

/** Where a message is: its channel, and its timestamp, which is its id. */
export interface Posted {
  readonly channel: string;
  readonly ts: string;
}

export interface Channel {
  readonly id: string;
  /** Without "#". */
  readonly name: string;
  readonly isPrivate: boolean;
  /** The bot is in it, so it can post there. */
  readonly isMember: boolean;
}

export interface User {
  readonly id: string;
  readonly name: string;
  readonly realName: string | undefined;
  readonly email: string;
}

export interface Message {
  readonly channel: string;
  /** Shown in notifications, and where blocks can't be. */
  readonly text: string;
  readonly blocks?: Blocks;
  /** Posts in the thread of this message. */
  readonly threadTs?: string;
}

export class Slack extends Context.Service<
  Slack,
  {
    readonly postMessage: (
      message: Message,
    ) => Effect.Effect<Posted, SlackError>;
    /** Replaces a message's text and blocks. */
    readonly updateMessage: (
      message: Posted & Omit<Message, "channel" | "threadTs">,
    ) => Effect.Effect<void, SlackError>;
    readonly deleteMessage: (
      message: Posted,
    ) => Effect.Effect<void, SlackError>;
    /** The workspace's channels the bot can see, unarchived. */
    readonly channels: Effect.Effect<ReadonlyArray<Channel>, SlackError>;
    readonly userByEmail: (
      email: string,
    ) => Effect.Effect<Option.Option<User>, SlackError>;
  }
>()("@skjera/slack/Slack") {
  /** On Slack's Web API with a bot token ("xoxb-…"). */
  static readonly make = (options: {
    readonly token: Redacted.Redacted<string>;
    /** Slack's API, unless told otherwise ("https://slack.com/api/"). */
    readonly apiUrl?: string;
    readonly timeout?: Duration.Input;
  }) => {
    const client = new WebClient(Redacted.value(options.token), {
      retryConfig: { retries: 0 },
      rejectRateLimitedCalls: true,
      logLevel: LogLevel.ERROR,
      timeout: Duration.toMillis(
        Duration.fromInputUnsafe(options.timeout ?? "10 seconds"),
      ),
      ...(options.apiUrl === undefined ? {} : { slackApiUrl: options.apiUrl }),
    });
    return Slack.of(fromClient(client));
  };

  static readonly layer = (options: Parameters<typeof Slack.make>[0]) =>
    Layer.succeed(Slack, Slack.make(options));
}

/** Slack's errors as ours. */
const toError = (method: string, error: unknown): SlackError => {
  const code = (error as { code?: unknown }).code;
  switch (code) {
    case ErrorCode.PlatformError:
      return new SlackApiError({
        method,
        code: String((error as { data?: { error?: unknown } }).data?.error),
      });
    case ErrorCode.RateLimitedError:
      return new SlackRateLimited({
        method,
        retryAfter: Number((error as { retryAfter?: unknown }).retryAfter),
      });
    case ErrorCode.HTTPError: {
      const http = error as { statusCode: number; statusMessage: string };
      return new SlackUnavailable({
        method,
        message: http.statusMessage,
        status: http.statusCode,
      });
    }
    default:
      return new SlackUnavailable({
        method,
        message: error instanceof Error ? error.message : String(error),
      });
  }
};

const fromClient = (client: WebClient): Slack["Service"] => {
  const call = <A>(method: string, run: () => Promise<A>) =>
    Effect.tryPromise({ try: run, catch: (error) => toError(method, error) });

  const channels = Effect.gen(function* () {
    const all: Array<Channel> = [];
    let cursor: string | undefined;
    do {
      const page = yield* call("conversations.list", () =>
        client.conversations.list({
          types: "public_channel,private_channel",
          exclude_archived: true,
          limit: 200,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      );
      for (const channel of page.channels ?? []) {
        if (channel.id === undefined || channel.name === undefined) continue;
        all.push({
          id: channel.id,
          name: channel.name,
          isPrivate: channel.is_private === true,
          isMember: channel.is_member === true,
        });
      }
      cursor = page.response_metadata?.next_cursor || undefined;
    } while (cursor !== undefined);
    return all;
  });

  return {
    postMessage: (message) =>
      call("chat.postMessage", () =>
        client.chat.postMessage({
          channel: message.channel,
          text: message.text,
          ...(message.blocks === undefined
            ? {}
            : { blocks: [...message.blocks] }),
          ...(message.threadTs === undefined
            ? {}
            : { thread_ts: message.threadTs }),
        }),
      ).pipe(
        Effect.flatMap((posted) =>
          posted.channel === undefined || posted.ts === undefined
            ? Effect.die("Slack posted a message without its channel or ts")
            : Effect.succeed({ channel: posted.channel, ts: posted.ts }),
        ),
      ),
    updateMessage: (message) =>
      Effect.asVoid(
        call("chat.update", () =>
          client.chat.update({
            channel: message.channel,
            ts: message.ts,
            text: message.text,
            ...(message.blocks === undefined
              ? {}
              : { blocks: [...message.blocks] }),
          }),
        ),
      ),
    deleteMessage: (message) =>
      Effect.asVoid(
        call("chat.delete", () =>
          client.chat.delete({ channel: message.channel, ts: message.ts }),
        ),
      ),
    channels,
    userByEmail: (email) =>
      call("users.lookupByEmail", () =>
        client.users.lookupByEmail({ email }),
      ).pipe(
        Effect.map((found) => {
          const user = found.user;
          return user?.id === undefined || user.name === undefined
            ? Option.none<User>()
            : Option.some<User>({
                id: user.id,
                name: user.name,
                realName: user.real_name,
                email: user.profile?.email ?? email,
              });
        }),
        Effect.catchIf(
          (error) =>
            error._tag === "SlackApiError" && error.code === "users_not_found",
          () => Effect.succeedNone,
        ),
      ),
  };
};

/**
 * Tries again what may work later: after a rate limit, when Slack says to;
 * when it's unavailable, after 1, 2, 4, … seconds (from `base`, at most a
 * minute). At most `times` more tries; Slack saying no isn't retried.
 */
export const retryTransient =
  (options: { readonly times?: number; readonly base?: Duration.Input } = {}) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
    const times = options.times ?? 5;
    const base = Duration.fromInputUnsafe(options.base ?? "1 second");
    const delay = (error: SlackRateLimited | SlackUnavailable, n: number) =>
      error._tag === "SlackRateLimited"
        ? Duration.seconds(error.retryAfter)
        : Duration.min(Duration.times(base, 2 ** n), Duration.minutes(1));
    const attempt = (n: number): Effect.Effect<A, E, R> =>
      self.pipe(
        Effect.catchIf(
          (error): error is E & (SlackRateLimited | SlackUnavailable) =>
            n < times &&
            (error instanceof SlackRateLimited ||
              error instanceof SlackUnavailable),
          (error) =>
            Effect.sleep(delay(error, n)).pipe(
              Effect.andThen(Effect.suspend(() => attempt(n + 1))),
            ),
        ),
      );
    return attempt(0);
  };
