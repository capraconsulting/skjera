import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Option, Redacted } from "effect";
import {
  retryTransient,
  Slack,
  SlackApiError,
  SlackRateLimited,
  SlackUnavailable,
} from "../src/Slack.ts";
import * as SlackTest from "../src/testing.ts";

// Slack's own client, against a server playing Slack's Web API: what's sent,
// and how its answers and failures come back.

interface Received {
  readonly method: string;
  readonly params: Record<string, string>;
  readonly authorization: string | undefined;
}

interface Reply {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body: unknown;
}

/** A server answering Slack API calls with `replies`, by method, in turn. */
const fakeSlack = (replies: Record<string, ReadonlyArray<Reply>>) =>
  Effect.acquireRelease(
    Effect.callback<{
      readonly url: string;
      readonly received: Array<Received>;
      readonly close: () => void;
    }>((resume) => {
      const received: Array<Received> = [];
      const turns = new Map<string, number>();
      const server = createServer((request, response) => {
        let body = "";
        request.on("data", (chunk) => {
          body += chunk;
        });
        request.on("end", () => {
          const method = (request.url ?? "").replace(/^\/api\//, "");
          received.push({
            method,
            params: Object.fromEntries(new URLSearchParams(body)),
            authorization: request.headers.authorization,
          });
          const turn = turns.get(method) ?? 0;
          turns.set(method, turn + 1);
          const all = replies[method] ?? [];
          const reply = all[Math.min(turn, all.length - 1)] ?? {
            body: { ok: false, error: "unknown_method" },
          };
          response.writeHead(reply.status ?? 200, {
            "content-type": "application/json",
            ...reply.headers,
          });
          response.end(JSON.stringify(reply.body));
        });
      });
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        resume(
          Effect.succeed({
            url: `http://127.0.0.1:${port}/api/`,
            received,
            close: () => server.close(),
          }),
        );
      });
    }),
    (fake) => Effect.sync(fake.close),
  );

const token = Redacted.make("xoxb-test-token");

describe("Slack", () => {
  it.effect("posts, changes and deletes messages", () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack({
        "chat.postMessage": [
          { body: { ok: true, channel: "C1", ts: "1700000001.000100" } },
        ],
        "chat.update": [{ body: { ok: true } }],
        "chat.delete": [{ body: { ok: true } }],
      });
      const slack = Slack.make({ token, apiUrl: fake.url });
      const posted = yield* slack.postMessage({
        channel: "C1",
        text: "New event",
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "*New*" } }],
        threadTs: "1700000000.000100",
      });
      assert.deepStrictEqual(posted, {
        channel: "C1",
        ts: "1700000001.000100",
      });
      yield* slack.updateMessage({ ...posted, text: "Changed" });
      yield* slack.deleteMessage(posted);

      const [post, update, remove] = fake.received;
      assert.strictEqual(post?.method, "chat.postMessage");
      assert.strictEqual(post?.authorization, "Bearer xoxb-test-token");
      assert.strictEqual(post?.params.thread_ts, "1700000000.000100");
      assert.deepStrictEqual(JSON.parse(post?.params.blocks ?? "null"), [
        { type: "section", text: { type: "mrkdwn", text: "*New*" } },
      ]);
      assert.deepStrictEqual(
        [update?.method, update?.params.ts, update?.params.text],
        ["chat.update", "1700000001.000100", "Changed"],
      );
      assert.deepStrictEqual(
        [remove?.method, remove?.params.channel],
        ["chat.delete", "C1"],
      );
    }).pipe(Effect.scoped),
  );

  it.effect("lists channels across pages", () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack({
        "conversations.list": [
          {
            body: {
              ok: true,
              channels: [
                {
                  id: "C1",
                  name: "events",
                  is_private: false,
                  is_member: true,
                },
              ],
              response_metadata: { next_cursor: "page-2" },
            },
          },
          {
            body: {
              ok: true,
              channels: [
                {
                  id: "C2",
                  name: "secret",
                  is_private: true,
                  is_member: false,
                },
              ],
              response_metadata: { next_cursor: "" },
            },
          },
        ],
      });
      const slack = Slack.make({ token, apiUrl: fake.url });
      assert.deepStrictEqual(yield* slack.channels, [
        { id: "C1", name: "events", isPrivate: false, isMember: true },
        { id: "C2", name: "secret", isPrivate: true, isMember: false },
      ]);
      assert.deepStrictEqual(
        fake.received.map((call) => call.params.cursor),
        [undefined, "page-2"],
      );
      assert.strictEqual(fake.received[0]?.params.exclude_archived, "true");
    }).pipe(Effect.scoped),
  );

  it.effect("finds users by email, or doesn't", () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack({
        "users.lookupByEmail": [
          {
            body: {
              ok: true,
              user: {
                id: "U1",
                name: "alice",
                real_name: "Alice A.",
                profile: { email: "alice@example.com" },
              },
            },
          },
          { body: { ok: false, error: "users_not_found" } },
        ],
      });
      const slack = Slack.make({ token, apiUrl: fake.url });
      assert.deepStrictEqual(
        yield* slack.userByEmail("alice@example.com"),
        Option.some({
          id: "U1",
          name: "alice",
          realName: "Alice A.",
          email: "alice@example.com",
        }),
      );
      assert.isTrue(
        Option.isNone(yield* slack.userByEmail("nobody@example.com")),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("fails as Slack says: no, later, or not now", () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack({
        "chat.postMessage": [
          { body: { ok: false, error: "not_in_channel" } },
          { status: 429, headers: { "retry-after": "3" }, body: { ok: false } },
          { status: 503, body: { ok: false } },
        ],
      });
      const slack = Slack.make({ token, apiUrl: fake.url });
      const post = Effect.flip(
        slack.postMessage({ channel: "C1", text: "Hello" }),
      );
      assert.deepStrictEqual(
        yield* post,
        new SlackApiError({
          method: "chat.postMessage",
          code: "not_in_channel",
        }),
      );
      assert.deepStrictEqual(
        yield* post,
        new SlackRateLimited({ method: "chat.postMessage", retryAfter: 3 }),
      );
      const unavailable = yield* post;
      assert.instanceOf(unavailable, SlackUnavailable);
      assert.strictEqual(
        unavailable instanceof SlackUnavailable ? unavailable.status : 0,
        503,
      );
      // Each was asked once: Slack's client doesn't retry on its own.
      assert.strictEqual(fake.received.length, 3);
      // The token stays out of errors.
      assert.notInclude(JSON.stringify(unavailable), "xoxb");
    }).pipe(Effect.scoped),
  );

  // Real clock: retries wait.
  it.live("retries what may work later, and not what won't", () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack({
        "chat.postMessage": [
          { status: 500, body: { ok: false } },
          { status: 429, headers: { "retry-after": "0" }, body: { ok: false } },
          { body: { ok: true, channel: "C1", ts: "1.000100" } },
        ],
        "chat.update": [{ body: { ok: false, error: "message_not_found" } }],
      });
      const slack = Slack.make({ token, apiUrl: fake.url });
      const retry = retryTransient({ base: "10 millis" });
      const posted = yield* slack
        .postMessage({ channel: "C1", text: "Hello" })
        .pipe(retry);
      assert.strictEqual(posted.ts, "1.000100");

      const update = yield* slack
        .updateMessage({ channel: "C1", ts: "9.9", text: "Gone" })
        .pipe(retry, Effect.exit);
      assert.isTrue(Exit.isFailure(update));
      assert.deepStrictEqual(
        fake.received.map((call) => call.method),
        [
          "chat.postMessage",
          "chat.postMessage",
          "chat.postMessage",
          "chat.update",
        ],
      );
    }).pipe(Effect.scoped),
  );

  it.live("gives up after the retries allowed", () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack({
        "chat.postMessage": [{ status: 502, body: { ok: false } }],
      });
      const slack = Slack.make({ token, apiUrl: fake.url });
      const error = yield* slack
        .postMessage({ channel: "C1", text: "Hello" })
        .pipe(retryTransient({ times: 2, base: "10 millis" }), Effect.flip);
      assert.instanceOf(error, SlackUnavailable);
      assert.strictEqual(fake.received.length, 3);
    }).pipe(Effect.scoped),
  );
});

describe("SlackTest", () => {
  it.effect("keeps a workspace's messages, as Slack would", () =>
    Effect.gen(function* () {
      const workspace = SlackTest.make({
        channels: [
          { id: "C1", name: "events" },
          { id: "C2", name: "elsewhere", isMember: false },
        ],
        users: [
          {
            id: "U1",
            name: "alice",
            realName: undefined,
            email: "alice@example.com",
          },
        ],
      });
      const slack = workspace.slack;
      const posted = yield* slack.postMessage({ channel: "C1", text: "One" });
      yield* slack.postMessage({
        channel: "C1",
        text: "Reply",
        threadTs: posted.ts,
      });
      yield* slack.updateMessage({ ...posted, text: "One, changed" });
      assert.deepStrictEqual(
        workspace
          .messages("C1")
          .map((message) => [message.text, message.threadTs]),
        [
          ["One, changed", undefined],
          ["Reply", posted.ts],
        ],
      );
      yield* slack.deleteMessage(posted);
      assert.strictEqual(workspace.messages("C1").length, 1);

      // Only in channels the bot is in, which can change.
      const refused = yield* Effect.flip(
        slack.postMessage({ channel: "C2", text: "Hi" }),
      );
      assert.deepStrictEqual(
        refused,
        new SlackApiError({
          method: "chat.postMessage",
          code: "not_in_channel",
        }),
      );
      workspace.setMember("C2", true);
      yield* slack.postMessage({ channel: "C2", text: "Hi" });
      assert.deepStrictEqual(
        yield* Effect.flip(slack.postMessage({ channel: "C9", text: "?" })),
        new SlackApiError({
          method: "chat.postMessage",
          code: "channel_not_found",
        }),
      );
      assert.isTrue(
        Option.isSome(yield* slack.userByEmail("ALICE@example.com")),
      );

      // Failures on cue, once.
      workspace.failNext(
        "postMessage",
        new SlackRateLimited({ method: "chat.postMessage", retryAfter: 1 }),
      );
      assert.strictEqual(
        (yield* Effect.flip(slack.postMessage({ channel: "C1", text: "Two" })))
          ._tag,
        "SlackRateLimited",
      );
      yield* slack.postMessage({ channel: "C1", text: "Two" });
    }),
  );
});
