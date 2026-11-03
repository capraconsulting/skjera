# EXT-05: Slack

Slack is told of new events, and each morning of events whose sign-up closes within a day.

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

## AC-3: Sign-ups closing within a day, each morning

Every day at 07:00 UTC, Skjera SHALL post one message with `@channel` to the configured Slack channel listing each published event that has not started and whose sign-up closes within the next 24 hours, at the deadline the organiser set or, without one, at its start, each as a link to its page with when sign-up closes in Norwegian time.

**Test**

- **Given** Slack set up, and an event published with a **Sign-up deadline** before 07:00 UTC tomorrow, and one without a deadline that starts before 07:00 UTC tomorrow
- **When** `pnpm dev` runs past 07:00 UTC
- **Then** one message with `@channel` comes, listing both events, soonest first, each with when sign-up closes in Norwegian time

**Automated:** `packages/documents/test/notices/SlackChannel.test.ts`

## AC-4: No sign-up closing, no message

IF no event closes for sign-up within the next 24 hours, THEN Skjera SHALL post no message about it that day.

**Test**

- **Given** no event that closes for sign-up within the next 24 hours
- **When** `pnpm dev` runs past 07:00 UTC
- **Then** no message comes

**Automated:** `packages/documents/test/notices/SlackChannel.test.ts`

## AC-5: Only what closes within a day

The message SHALL NOT list an event whose sign-up closes more than 24 hours ahead, whether at a deadline or at its start, nor a deleted one.

**Test**

- **Given** the set-up from AC-3, and also an event with a deadline 30 hours ahead, an event without one that starts 30 hours ahead, and a deleted event that closes within the 24 hours
- **When** the message comes
- **Then** none of them is in it

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

## AC-9: The category is in the message

WHERE an event has a tag named «Sosialt» or «Fag», in any mix of capital and small letters, the message about it published for the first time SHALL have «*Kategori:*» («*Category:*» in English) with that name, beside the time and the place. An event with both has the first. An event without such a tag has no category in the message.

**Test**

- **Given** Slack set up, and a new event with the tag «fag»
- **When** you publish it
- **Then** the channel's message has «Kategori: Fag» beside the time and the place
- **When** you publish an event with the tag «Workshop» only
- **Then** its message has no category

**Automated:** `packages/documents/test/notices/SlackChannel.test.ts`, `packages/documents/test/Model.test.ts`
