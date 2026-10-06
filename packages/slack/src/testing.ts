import { Effect, Layer, Option } from "effect";
import {
  type Blocks,
  type Channel,
  Slack,
  SlackApiError,
  type SlackError,
  type User,
} from "./Slack.ts";

// A pretend Slack workspace in memory, for testing what posts to Slack:
// its channels, what's in them, and failures on cue. It behaves as Slack
// does where it matters: the bot posts only in channels it's in, messages
// get timestamps as ids, and they can be changed and deleted.

export interface Stored {
  readonly ts: string;
  readonly text: string;
  readonly blocks: Blocks | undefined;
  readonly threadTs: string | undefined;
}

type Method =
  | "postMessage"
  | "updateMessage"
  | "deleteMessage"
  | "channels"
  | "userByEmail";

export const make = (
  options: {
    readonly channels?: ReadonlyArray<
      Omit<Channel, "isPrivate" | "isMember"> & Partial<Channel>
    >;
    readonly users?: ReadonlyArray<User>;
  } = {},
) => {
  const channels: Array<Channel> = (options.channels ?? []).map((channel) => ({
    isPrivate: false,
    isMember: true,
    ...channel,
  }));
  const messages = new Map<string, Array<Stored>>();
  const failures: Array<{
    readonly method: Method;
    readonly error: SlackError;
  }> = [];
  let clock = 1_700_000_000;

  /** Fails with the error set for `method`, if any, once. */
  const failure = (method: Method) =>
    Effect.suspend(() => {
      const at = failures.findIndex((each) => each.method === method);
      if (at === -1) return Effect.void;
      const [next] = failures.splice(at, 1);
      return next === undefined ? Effect.void : Effect.fail(next.error);
    });

  const inChannel = (method: string, id: string) =>
    Effect.suspend(() => {
      const channel = channels.find((each) => each.id === id);
      if (channel === undefined) {
        return Effect.fail(
          new SlackApiError({ method, code: "channel_not_found" }),
        );
      }
      if (!channel.isMember) {
        return Effect.fail(
          new SlackApiError({ method, code: "not_in_channel" }),
        );
      }
      return Effect.succeed(messages.get(id) ?? []);
    });

  const find = (method: string, channel: string, ts: string) =>
    Effect.flatMap(inChannel(method, channel), (stored) => {
      const at = stored.findIndex((message) => message.ts === ts);
      return at === -1
        ? Effect.fail(new SlackApiError({ method, code: "message_not_found" }))
        : Effect.succeed({ stored, at });
    });

  const slack = Slack.of({
    postMessage: (message) =>
      Effect.gen(function* () {
        yield* failure("postMessage");
        const stored = yield* inChannel("chat.postMessage", message.channel);
        const ts = `${++clock}.000100`;
        messages.set(message.channel, [
          ...stored,
          {
            ts,
            text: message.text,
            blocks: message.blocks,
            threadTs: message.threadTs,
          },
        ]);
        return { channel: message.channel, ts };
      }),
    updateMessage: (message) =>
      Effect.gen(function* () {
        yield* failure("updateMessage");
        const { stored, at } = yield* find(
          "chat.update",
          message.channel,
          message.ts,
        );
        const old = stored[at];
        if (old === undefined) return;
        stored[at] = { ...old, text: message.text, blocks: message.blocks };
      }),
    deleteMessage: (message) =>
      Effect.gen(function* () {
        yield* failure("deleteMessage");
        const { stored, at } = yield* find(
          "chat.delete",
          message.channel,
          message.ts,
        );
        stored.splice(at, 1);
      }),
    channels: Effect.andThen(
      failure("channels"),
      Effect.sync(() => [...channels]),
    ),
    userByEmail: (email) =>
      Effect.andThen(
        failure("userByEmail"),
        Effect.sync(() =>
          Option.fromUndefinedOr(
            (options.users ?? []).find(
              (user) => user.email.toLowerCase() === email.toLowerCase(),
            ),
          ),
        ),
      ),
  });

  return {
    slack,
    layer: Layer.succeed(Slack, slack),
    /** What's in a channel now, oldest first. */
    messages: (channel: string): ReadonlyArray<Stored> => [
      ...(messages.get(channel) ?? []),
    ],
    /** Makes the next call of `method` fail with `error`. */
    failNext: (method: Method, error: SlackError) => {
      failures.push({ method, error });
    },
    /** The bot joins (or leaves) a channel. */
    setMember: (channel: string, isMember: boolean) => {
      const at = channels.findIndex((each) => each.id === channel);
      const found = channels[at];
      if (found !== undefined) channels[at] = { ...found, isMember };
    },
  };
};
