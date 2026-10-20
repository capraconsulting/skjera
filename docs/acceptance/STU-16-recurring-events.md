# STU-16: Recurring events

A recurring event moves on to its next date when it has ended, and starts afresh.

The server moves recurring events once a day, at 06:30 UTC (08:30 Norwegian summer time, 07:30 in winter). It can't be started by hand, so AC-2, AC-3, AC-5 and AC-7 are tested overnight: leave `pnpm dev` running past 06:30 UTC.

**Events:** in team «STU-16: Recurring events»:

| Event | Set-up |
| --- | --- |
| AC-1: Not recurring | public, next month |
| AC-2, AC-3 and AC-5: Every other week | public, today 20:00, sign-up deadline today 19:00, food served with a food deadline today 18:00, repeating every 2 weeks. Bob signs up with a dietary preference. |
| AC-7: Recurring, not published | today 20:00, repeating every day, not published |

Pick «Every other week» so its next date falls after a change between summer and winter time, if one is near.

## AC-1: Recurring is set in the studio

The studio shall let an organiser mark an event as recurring, every 1 to 7 days, weeks, months or years, and shall treat an event as not recurring unless it is marked.

**Test**

- **Given** «AC-1: Not recurring» open in the studio
- **When** you tick **The event repeats**, and look at **Repeat every** and **Repeat unit**
- **Then** they offer 1 to 7, and days, weeks, months or years; unticked, the event doesn't repeat

**Automated:** `packages/app/e2e/specs/collaboration.spec.ts`, `packages/documents/test/events/content.test.ts`, `packages/documents/test/events/recurring/moving.test.ts`

## AC-2: Moved on and published again

Every day at 06:30 UTC, the server shall move each published recurring event whose end has passed on to the first date in its series whose end has not passed, and publish it again.

**Test**

- **Given** «Every other week», ended in the evening
- **When** `pnpm dev` has run past 06:30 UTC, and you open the event on the site and in the studio
- **Then** it is two weeks later, and published

**Automated:** `packages/documents/test/events/recurring/moving.test.ts`, `packages/documents/test/events/recurring/nextDate.test.ts`

## AC-3: Every time moves alike, at the same time of day

When a recurring event is moved, its start, end, sign-up deadline and food deadline shall all move by the same interval, keeping their time of day in the event's time zone across a change between summer and winter time.

**Test**

- **Given** «Every other week», moved as in AC-2
- **When** you look at its times in the studio
- **Then** start 20:00, sign-up deadline 19:00 and food deadline 18:00, all on the new date, also across a change of summer and winter time

**Automated:** `packages/documents/test/events/recurring/moving.test.ts`, `packages/documents/test/events/recurring/nextDate.test.ts`

## AC-4: The 31st becomes the month's last day

When a monthly or yearly recurring event is moved from a day the next month does not have, its new date shall be the last day of that month.

**Automated only:** the dates line up only a few times a year. `packages/documents/test/events/recurring/nextDate.test.ts`

## AC-5: It starts afresh, without email

When a recurring event is moved, the server shall remove everyone signed up and the event's dietary preferences, and shall send no email about it.

**Test**

- **Given** «Every other week» with bob signed up with a dietary preference, moved as in AC-2
- **When** you open it as bob, in the studio, and in Mailpit
- **Then** bob is no longer signed up, «Dietary preferences» is empty, and no email was sent about it

**Automated:** `packages/documents/test/events/recurring/moving.test.ts`

## AC-6: Slack is told

When a recurring event is moved, the server shall post it to the configured Slack channel as it posts a new event, with `@here` and a mark that it repeats.

**Test**

- **Given** Slack set up as in [EXT-05](EXT-05-slack.md); without it, this is left to the tests
- **When** «Every other week» is moved as in AC-2
- **Then** the channel gets a message as for a new event, marked as repeating

**Automated:** `packages/documents/test/events/recurring/moving.test.ts`, `packages/documents/test/notices/SlackChannel.test.ts`

## AC-7: Not moved when deleted or unpublished

The server shall not move a recurring event that has been deleted or is not published.

**Test**

- **Given** «AC-7: Recurring, not published», ended in the evening
- **When** `pnpm dev` has run past 06:30 UTC, and you open it in the studio
- **Then** it is still on its first date. A deleted event is left to the tests.

**Automated:** `packages/documents/test/events/recurring/moving.test.ts`

## AC-8: Moved once with several servers

If more than one server runs, then each recurring event shall be moved once per day, and its Slack message posted once.

**Automated only:** `packages/documents/test/events/recurring/moving.test.ts`
