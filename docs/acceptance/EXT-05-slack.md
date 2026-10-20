# EXT-05: Slack

Slack is told of new events, and each morning of sign-up deadlines that run out within a day.

**Set-up:** a Slack app made from `packages/slack/manifest.yaml`, installed in a channel for testing, with `SLACK_BOT_TOKEN`, `SLACK_CHANNEL` and `SITE_URL` under `[env]` in `mise.local.toml`. Restart `pnpm dev` after setting them. Without them, AC-1 to AC-5 and AC-8 are left to the tests.

## AC-1: A new event is posted

WHEN an event is published for the first time, Skjera SHALL post a message with `@here` to the configured Slack channel with the event's title, cover image, summary, a link to its page, when it starts and its place.

**Test**

- **Given** Slack set up, and a new event with a cover image and a summary
- **When** you publish it
- **Then** the channel gets a message with `@here`, the title, the image, the summary, a link to the event, the time and the place

**Automated:** `packages/documents/test/notices/SlackChannel.test.ts`, `packages/documents/test/events/publishing.test.ts`

## AC-2: Publishing again posts nothing

WHEN a published event is published again, Skjera SHALL NOT post a new message about it.

**Test**

- **Given** the event from AC-1
- **When** you change it and **Publish** again
- **Then** no new message comes

**Automated:** `packages/documents/test/events/publishing.test.ts`

## AC-3: Deadlines within a day, each morning

Every day at 07:00 UTC, Skjera SHALL post one message with `@channel` to the configured Slack channel listing each published event that has not started and whose sign-up deadline is within the next 24 hours, each as a link to its page with its deadline in Norwegian time.

**Test**

- **Given** Slack set up, and an event published with a **Sign-up deadline** before 07:00 UTC tomorrow
- **When** `pnpm dev` runs past 07:00 UTC
- **Then** one message with `@channel` comes, listing the event with its deadline in Norwegian time

**Automated:** `packages/documents/test/notices/SlackChannel.test.ts`

## AC-4: No deadlines, no message

IF no event has a sign-up deadline within the next 24 hours, THEN Skjera SHALL post no deadline message that day.

**Test**

- **Given** no event with a sign-up deadline within the next 24 hours
- **When** `pnpm dev` runs past 07:00 UTC
- **Then** no message comes

**Automated:** `packages/documents/test/notices/SlackChannel.test.ts`

## AC-5: Only deadlines the organiser set

The deadline message SHALL list only events with a sign-up deadline set by the organiser, not events whose sign-up closes at the start by default.

**Test**

- **Given** the set-up from AC-3, and also an event without a deadline that starts within the same 24 hours
- **When** the message comes
- **Then** that event isn't in it

**Automated:** `packages/documents/test/notices/SlackChannel.test.ts`

## AC-6: Posted once with several servers

IF more than one server runs, THEN Skjera SHALL post each day's deadline message once.

**Automated only:** `packages/documents/test/notices/SlackChannel.test.ts`

## AC-7: Without Slack, nothing changes

WHERE the server has no Slack token or channel configured, Skjera SHALL post nothing and publish and sign up as before.

**Test**

- **Given** no Slack settings
- **When** you start `pnpm dev`, publish an event and sign up to it
- **Then** all works, and the server warns at the start that nothing is posted to Slack

**Automated:** `packages/documents/test/notices/SlackChannel.test.ts`

## AC-8: Slack failing doesn't stop publishing

IF Slack refuses or cannot be reached, THEN Skjera SHALL still publish the event, and SHALL log the failure.

**Test**

- **Given** a wrong `SLACK_BOT_TOKEN`, and `pnpm dev` restarted
- **When** you publish a new event
- **Then** the event is published, and the server's log has the failure

**Automated:** `packages/documents/test/notices/SlackChannel.test.ts`
