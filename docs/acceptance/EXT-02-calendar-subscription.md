# EXT-02: Calendar subscription

A calendar of all coming events can be subscribed to from Google Calendar.

**Events:** coming events, both public and members only; one that has ended; one not published; and one deleted.

## AC-1: A calendar without logging in

When anyone requests `GET /api/subscribe`, without being logged in, the server shall answer with an iCalendar feed (`text/calendar`) named after the site, as `SITE_NAME` says («Skjera» when it is not set).

**Test**

- **Given** the events above
- **When** you run `curl -si http://localhost:3000/api/subscribe`
- **Then** it has `content-type: text/calendar` and `X-WR-CALNAME:Skjera`

**Automated:** `packages/app/e2e/specs/site.spec.ts`, `packages/documents/test/site/Calendar.test.ts`, `packages/documents/test/site/CalendarFeed.test.ts`

## AC-2: Every coming published event

The feed shall contain every published event whose end is in the future, both those shown to everyone and those for members only.

**Test**

- **Given** the feed from AC-1
- **When** you look for the coming events
- **Then** the public and the members-only ones are both there

**Automated:** `packages/app/e2e/specs/site.spec.ts`, `packages/documents/test/site/CalendarFeed.test.ts`

## AC-3: Not ended, unpublished or deleted ones

The feed shall not contain an event that has ended, an event that is not published, or an event that has been deleted.

**Test**

- **Given** the feed from AC-1
- **When** you look for the ended, the unpublished and the deleted event
- **Then** none of them are there

**Automated:** `packages/app/e2e/specs/site.spec.ts`, `packages/documents/test/site/CalendarFeed.test.ts`

## AC-4: What each event carries

Each event in the feed shall carry its title, its place, its start and end, the link to its event page, and a description made of its summary, a blank line and «Meld deg på eller av arrangementet: » followed by that link.

**Test**

- **Given** the feed from AC-1
- **When** you look at an event with a summary
- **Then** it has `SUMMARY`, `LOCATION`, `DTSTART`, `DTEND`, `URL`, and `DESCRIPTION` as described

**Automated:** `packages/documents/test/site/Calendar.test.ts`, `packages/documents/test/site/CalendarFeed.test.ts`

## AC-5: Events don't block time

Each event in the feed shall be marked as transparent, so it does not block time in the subscriber's calendar.

**Test**

- **Given** the feed from AC-1
- **When** you look at each event
- **Then** each has `TRANSP:TRANSPARENT`

**Automated:** `packages/documents/test/site/Calendar.test.ts`

## AC-6: «Subscribe» in the header

While a user is signed in, the page header shall show an «Abonner» link with a calendar icon, visible at every screen width beside the account menu and not inside it, that opens `https://www.google.com/calendar/render?cid=webcal://<host>/api/subscribe` for the host the page is served from.

**Test**

- **Given** bob logged in on the site
- **When** he looks at the header, also with the window narrow, and clicks the link
- **Then** «Subscribe» («Abonner» in Norwegian) with a calendar icon stands beside the account menu, and opens Google Calendar with the address above

**Automated:** `packages/app/e2e/specs/site.spec.ts`
