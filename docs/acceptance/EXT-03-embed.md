# EXT-03: The embed page

`/embed` lists the next three events shown to everyone, for the Capra and Liflig websites to show in an iframe.

**Events:** in team «EXT-03: Embed», all public and in the coming weeks, at 18:00:

| Event | Day | |
| --- | --- | --- |
| AC-1 and AC-2: First | first | |
| AC-3: Opens in a new tab | second | |
| AC-1: Not among the first three | third | |
| AC-1: Members only | first | not public |
| AC-1: Not published | first | not published |

Public events of other teams show on `/embed` too, so put these earlier than the rest, or count them in.

## AC-1: The next three, soonest first

Skjera SHALL serve a page at `/embed` that lists the next three events, soonest first, that are shown to everyone and have not ended.

**Test**

- **Given** the events above
- **When** you open http://localhost:5173/embed
- **Then** three events show, soonest first; «Members only» and «Not published» aren't there, nor «Not among the first three» when three public events come before it

**Automated:** `packages/documents/test/site/Embed.test.ts`

## AC-2: Title, time and organiser

The embed page SHALL show each event's title, when it starts and its organiser, as the front page shows the organiser.

**Test**

- **Given** `/embed` open
- **When** you look at «AC-1 and AC-2: First»
- **Then** it has its title, its start, and «EXT-03: Embed» as organiser, or the team's logo

**Automated:** `packages/documents/test/site/Embed.test.ts`

## AC-3: A click opens the event in a new tab

WHEN a visitor clicks an event on the embed page, Skjera SHALL open the event's page in a new tab.

**Test**

- **Given** `/embed` open
- **When** you click «AC-3: Opens in a new tab»
- **Then** the event's page opens in a new tab

**Automated:** `packages/app/e2e/specs/embed.spec.ts`, inside an iframe.

## AC-4: No events, an empty list

IF no event matches, THEN the embed page SHALL show an empty list without an error.

**Automated only:** it needs a site without any public coming event. `packages/documents/test/site/Embed.test.ts`

## AC-5: Only the websites may frame it

The embed page SHALL be allowed to be shown in an iframe only on the Capra and Liflig websites, whose addresses are set in the server's configuration.

**Test**

- **Given** `WEBSITE_ORIGINS` as in `mise.toml`
- **When** you run `curl -sI http://localhost:3000/embed`
- **Then** it has `content-security-policy: frame-ancestors http://website.localhost`, the address in `WEBSITE_ORIGINS`, and no other

**Automated:** `packages/app/e2e/specs/embed.spec.ts`, `packages/documents/test/site/Embed.test.ts`

## AC-6: The iframe takes the content's height

WHILE the embed page is shown in an iframe on a page that uses `@open-iframe-resizer`, the iframe SHALL take the height of the embed page's content.

**Automated only:** it needs a website page with the resizer. `packages/app/e2e/specs/embed.spec.ts`, which uses the websites' own script.
