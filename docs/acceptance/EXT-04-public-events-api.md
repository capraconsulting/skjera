# EXT-04: The public events API

`/api/public/events` gives the Capra and Liflig websites the coming events shown to everyone, in the format the websites read.

Use the server directly, http://localhost:3000. The app on port 5173 lets any website read it during development.

**Events:** in team «EXT-04: API», all public unless said, at 18:00 in the coming weeks:

| Event | |
| --- | --- |
| AC-1, AC-2 and AC-9: With a summary | |
| AC-4: Without a summary | |
| AC-5: Streamed | streamed |
| AC-5: Open to guests | open to guests |
| AC-6: Members only | not public |
| AC-6: Not published | not published |

And in a team named exactly «Capra Gruppen»: «EXT-04 AC-3: Organiser "Alle"».

## AC-1: Every coming public event, soonest first

Skjera SHALL serve `/api/public/events` as JSON: every published event shown to everyone that has not ended, soonest first.

**Test**

- **Given** the events above
- **When** you open http://localhost:3000/api/public/events
- **Then** it is JSON with the coming public events, soonest first

**Automated:** `packages/app/e2e/specs/embed.spec.ts`, `packages/documents/test/site/PublicEvents.test.ts`

## AC-2: The fields the websites read

The API SHALL give each event the fields `id`, `title`, `start`, `end`, `place`, `summary`, `category`, `organisers`, `isDigital`, `openForExternals` and `url`, with the names and types the websites read.

**Test**

- **Given** the answer from AC-1
- **When** you look at an event
- **Then** it has these eleven fields: `id`, `title`, `place` and `url` as text; `start` and `end` as times, such as `2026-11-03T17:00:00.000Z`; `summary` as text or `null`; `category` as `null`; `organisers` as text; `isDigital` and `openForExternals` as `true` or `false`

**Automated:** `packages/app/e2e/specs/embed.spec.ts`, `packages/documents/test/site/PublicEvents.test.ts`

## AC-3: «Alle» for Capra Gruppen

The API SHALL give `organisers` as `"Alle"` for an event of the team "Capra Gruppen", and as the team's name for an event of any other team.

**Test**

- **Given** the answer from AC-1
- **When** you look at `organisers`
- **Then** it is `"Alle"` for «EXT-04 AC-3: Organiser "Alle"», and `"EXT-04: API"` for the others

**Automated:** `packages/app/e2e/specs/embed.spec.ts`, `packages/documents/test/site/PublicEvents.test.ts`

## AC-4: No summary, no category

The API SHALL give `summary` as `null` for an event without a summary, and `category` as `null` for every event.

**Test**

- **Given** the answer from AC-1
- **When** you look at «AC-4: Without a summary»
- **Then** it has `"summary": null`, and every event has `"category": null`

**Automated:** `packages/app/e2e/specs/embed.spec.ts`, `packages/documents/test/site/PublicEvents.test.ts`

## AC-5: Streamed, open to guests, and the address

The API SHALL give `isDigital` as whether the event is streamed, `openForExternals` as whether guests can sign up, and `url` as the address of the event's page in Skjera.

**Test**

- **Given** the answer from AC-1
- **When** you look at the two «AC-5» events, and open a `url`
- **Then** `"isDigital": true` only for «AC-5: Streamed», `"openForExternals": true` only for «AC-5: Open to guests», and the `url` opens the event

**Automated:** `packages/app/e2e/specs/embed.spec.ts`, `packages/documents/test/site/PublicEvents.test.ts`

## AC-6: Not for members only, unpublished or ended

The API SHALL NOT give an event that is shown only to members, is not published, or has ended.

**Test**

- **Given** the answer from AC-1
- **When** you look for the two «AC-6» events and any that have ended
- **Then** none of them are there

**Automated:** `packages/app/e2e/specs/embed.spec.ts`, `packages/documents/test/site/PublicEvents.test.ts`

## AC-7: The websites may read it

WHEN a browser on one of the websites set in the server's configuration fetches the API, Skjera SHALL allow it to read the answer.

**Test**

- **Given** `WEBSITE_ORIGINS` as in `mise.toml`
- **When** you run `curl -sI -H "Origin: http://website.localhost" http://localhost:3000/api/public/events`
- **Then** it has `access-control-allow-origin: http://website.localhost`

**Automated:** `packages/app/e2e/specs/embed.spec.ts`, `packages/documents/test/site/PublicEvents.test.ts`

## AC-8: Other websites may not

IF a browser on any other website fetches the API, THEN Skjera SHALL NOT allow it to read the answer.

**Test**

- **Given** the same
- **When** you run the same with `Origin: http://other.localhost`
- **Then** there is no `access-control-allow-origin`

**Automated:** `packages/app/e2e/specs/embed.spec.ts`, `packages/documents/test/site/PublicEvents.test.ts`

## AC-9: Cached for five minutes

The API's answer SHALL allow being cached for five minutes.

**Test**

- **Given** the same
- **When** you run the command from AC-7
- **Then** it has `cache-control: public, max-age=300`

**Automated:** `packages/documents/test/site/PublicEvents.test.ts`
