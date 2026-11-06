# SITE-02: Front page: upcoming and past events

The front page lists the events coming up as rows, with what to know at a glance, and the events that are over as cards with their pictures.

**Events:** public, and not open to guests, unless said otherwise:

- «AC-1 to AC-6: Coming», tomorrow, and «AC-1 to AC-2: Later», a week later.
- «AC-3: Members only», members-only, coming up.
- «AC-3 to AC-4: Today», later today, with the tag «Workshop».
- «AC-5: Going on now», started an hour ago and ending in an hour.
- «AC-3 to AC-6: Signed up», open to guests, with bob and one guest signed up.
- «AC-1 to AC-7: Past 1» to «AC-1 to AC-7: Past 7», seven events that are over, a day apart with «AC-1 to AC-7: Past 1» the earliest, each with a cover image and the tag «Past 7».

Both lists show six events at first, and six more each time **Show more events** is clicked. An event a test looks for may therefore be behind the button: click it until the event shows (this holds for the hand tests in other files that look on the front page, too).

The organiser shown on each row and card is in [STU-02](STU-02-organiser-logo.md), and the filters in [SITE-03](SITE-03-tag-filter.md) and [SITE-04](SITE-04-guest-filter.md).

## AC-1: Coming up and over, apart

The front page SHALL list under «Upcoming events» every event coming up or going on, and under «Past events» every event that is over, six at a time.

**Test**

- **Given** the events
- **When** you open the front page, and click **Show more events** under each list until it is gone
- **Then** «AC-1 to AC-6: Coming» and «AC-1 to AC-2: Later» are under «Upcoming events», and the «AC-1 to AC-7: Past …» events under «Past events»

**Automated:** `packages/app/e2e/specs/tags.spec.ts`

## AC-2: Soonest first, latest first

The front page SHALL list upcoming events the soonest first, and past events the latest first.

**Test**

- **Given** the events
- **When** you open http://localhost:5173, and click **Show more events** under each list until it is gone
- **Then** «AC-1 to AC-6: Coming» is above «AC-1 to AC-2: Later», and among the past events «AC-1 to AC-7: Past 7» is above «AC-1 to AC-7: Past 6», and so on down to «AC-1 to AC-7: Past 1»

**Automated:** `packages/app/test/frontPage.test.ts`

## AC-3: Who it's for, on each row

WHILE guests can sign up for an event, the front page SHALL mark it «For alle» and its page SHALL say «Åpent for alle»; WHILE they can't, the front page SHALL mark it «Kun interne» and its page SHALL say «Kun for interne», whether the event is shown to everyone or only to members. Nynorsk and English have words of their own. The front page SHALL also show each upcoming event's tags.

**Test**

- **Given** the events
- **When** bob opens the front page
- **Then** «AC-3 to AC-6: Signed up» says «Open to all» on its row and on its page, «AC-1 to AC-6: Coming» and «AC-3: Members only» say «Internal only» on theirs, and «AC-3 to AC-4: Today» shows «#Workshop»

**Automated:** `packages/app/test/frontPage.test.ts`, `packages/app/test/audience.test.ts`, `packages/app/e2e/specs/attendance/members.spec.ts`

## AC-4: The day, or today's time

The front page SHALL show the day each upcoming event starts, in its own time zone, and «Today at» its time when that day is today.

**Test**

- **Given** the events
- **When** you open the front page
- **Then** «AC-3 to AC-4: Today» says «Today at» and its start time, and «AC-1 to AC-6: Coming» says tomorrow's date

**Automated:** `packages/app/test/frontPage.test.ts`

## AC-5: An event going on now

WHILE an event is going on, the front page SHALL keep it under «Upcoming events» and mark it «Happening now».

**Test**

- **Given** «AC-5: Going on now»
- **When** you open the front page
- **Then** it is under «Upcoming events», marked «Happening now», and «AC-1 to AC-6: Coming» isn't

**Automated:** `packages/app/test/frontPage.test.ts`

## AC-6: Your own sign-ups are marked

WHERE the person reading has signed up for an upcoming event, as a member or as a guest in the same browser, the front page SHALL mark it «You're signed up».

**Test**

- **Given** «AC-3 to AC-6: Signed up», with bob signed up, and a guest signed up in a private window
- **When** bob opens the front page, and the guest opens it in the same private window
- **Then** both see «You're signed up» on «AC-3 to AC-6: Signed up», and not on «AC-1 to AC-6: Coming»
- **When** you close every private window, and open the front page in a new one
- **Then** «AC-3 to AC-6: Signed up» isn't marked

**Automated:** `packages/app/e2e/specs/attendance/members.spec.ts`

## AC-7: Past events six at a time

The front page SHALL show past events as cards with their cover image, six at first, and six more each time **Show more events** is clicked, until none are left. The filters don't change which past events show.

**Test**

- **Given** the events, which make twelve past events in all
- **When** you open http://localhost:5173
- **Then** six cards show under «Past events», and **Show more events** under them
- **When** you click **Show more events**
- **Then** six more show, and the button is gone

**Automated:** `packages/app/test/frontPage.test.ts` (the paging rule)

## AC-8: Nothing to show

The front page SHALL always show the heading «Past events». IF no event is coming up, or none matches the filters, THEN the front page SHALL say «No upcoming events found in this category 😭» under «Upcoming events»; IF no event is over, THEN it SHALL say «No past events found 😭» under «Past events». Nynorsk and English have words of their own.

The development database has events from earlier tests, so this one is tested on a test server ([OPS-07](OPS-07-test-servers.md)), which starts with a database of its own.

**Test**

- **Given** a test server started with `PORT=8801 mise exec -- pnpm test-server`
- **When** you open http://localhost:8801
- **Then** «Upcoming events» says «No upcoming events found in this category 😭», and «Past events» shows with «No past events found 😭» under it
- **When** you publish one event that is over, at http://localhost:8801/studio, and reload
- **Then** «Upcoming events» still says «No upcoming events found in this category 😭», with the event under «Past events»

**Automated:** `packages/app/e2e/specs/tags.spec.ts`

## AC-9: Upcoming events six at a time

The front page SHALL show the upcoming events as rows, six at first, and six more each time **Show more events** is clicked, until none are left. WHEN a filter is chosen, the front page SHALL start the list again at six.

**Test**

- **Given** the events, which make far more than six upcoming events in all
- **When** you open http://localhost:5173
- **Then** six rows show under «Upcoming events», and **Show more events** under them
- **When** you click **Show more events** until it is gone
- **Then** every upcoming event shows
- **When** you click **Internal only**
- **Then** six rows show again, and **Show more events** is under them

**Automated:** `packages/app/test/frontPage.test.ts` (the paging rule), `packages/app/e2e/specs/tags.spec.ts`
