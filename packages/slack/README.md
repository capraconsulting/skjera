# @skjera/slack

The parts of Slack's Web API Skjera uses, as an Effect service, on Slack's
own client ([@slack/web-api](https://www.npmjs.com/package/@slack/web-api)).

```ts
import { retryTransient, Slack } from "@skjera/slack";

const announce = Effect.gen(function* () {
  const slack = yield* Slack;
  const posted = yield* slack
    .postMessage({ channel: "C0123", text: "New event: Launch", blocks })
    .pipe(retryTransient());
  // Later: slack.updateMessage({ ...posted, text, blocks }), deleteMessage(posted)
});

announce.pipe(Effect.provide(Slack.layerConfig)); // SLACK_BOT_TOKEN
```

- `postMessage`, `updateMessage`, `deleteMessage`: messages, by channel and
  timestamp (a message's id). `threadTs` posts in a thread.
- `channels`: the workspace's unarchived channels the bot can see, and
  whether it's in them (it can only post where it is).
- `userByEmail`: a Slack user, to match to a member.

## Errors

- `SlackApiError { code }`: Slack said no (`not_in_channel`,
  `channel_not_found`, `message_not_found`, `invalid_auth`, …). Retrying
  won't help.
- `SlackRateLimited { retryAfter }`: too many calls, try again in that many
  seconds.
- `SlackUnavailable { status? }`: Slack couldn't be reached, or failed.

Slack's client doesn't retry on its own: `retryTransient({ times, base })`
retries rate limits after `retryAfter`, and unavailability after 1, 2, 4, …
seconds, and nothing else. Retrying is the caller's to decide, e.g. a
cluster entity's handler posting to one channel at a time.

## Testing

`@skjera/slack/testing` is a workspace in memory: channels (posting only
where the bot is), their messages, users, and failures on cue.

```ts
const workspace = SlackTest.make({ channels: [{ id: "C1", name: "events" }] });
// Provide workspace.layer; then look at workspace.messages("C1"),
// workspace.failNext("postMessage", new SlackRateLimited({ … })).
```

## The Slack app

Each organisation creates its own app from [manifest.yaml](manifest.yaml),
installs it, and invites it to the channels it should post in.
