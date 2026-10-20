# SITE-02: Front page: upcoming and past events

The front page lists the events coming up as rows, with what to know at a glance, and the events that are over as cards with their pictures.

**Events:** public unless said otherwise:

- «AC-1: Coming», tomorrow, and «AC-1: Later», a week later.
- «AC-3: Members only», members-only, coming up.
- «AC-4: Today», later today, with the tag «Workshop».
- «AC-5: Going on now», started an hour ago and ending in an hour.
- «AC-6: Signed up», open to guests, with bob and one guest signed up.
- «AC-7: Past 1» to «AC-7: Past 7», seven events that are over, a day apart with «AC-7: Past 1» the earliest, each with a cover image and the tag «Past 7».

The organiser shown on each row and card is in [STU-02](STU-02-organiser-logo.md), and the filters in [SITE-03](SITE-03-tag-filter.md) and [SITE-04](SITE-04-guest-filter.md).

## AC-1: Coming up and over, apart

The front page SHALL list under «Upcoming events» every event coming up or going on, and under «Past events» every event that is over.

**Test**

- **Given** the events
- **When** you open the front page
- **Then** «AC-1: Coming» and «AC-1: Later» are under «Upcoming events», and the «AC-7: Past …» events under «Past events»

**Automated:** `packages/app/e2e/specs/tags.spec.ts`

## AC-2: Soonest first, latest first

The front page SHALL list upcoming events the soonest first, and past events the latest first.

**Test**

- **Given** the events
- **When** you open http://localhost:5173 and then http://localhost:5173/?tag=Past%207
- **Then** «AC-1: Coming» is above «AC-1: Later», and «AC-7: Past 7» comes first of the past events, «AC-7: Past 1» last

**Automated:** none

## AC-3: Who it's for, on each row

The front page SHALL mark each upcoming event «Open to all» or «Members only», and show its tags.

**Test**

- **Given** the events
- **When** bob opens the front page
- **Then** the public events say «Open to all», «AC-3: Members only» says «Members only», and «AC-4: Today» shows «#Workshop»

**Automated:** none

## AC-4: The day, or today's time

The front page SHALL show the day each upcoming event starts, in its own time zone, and «Today at» its time when that day is today.

**Test**

- **Given** the events
- **When** you open the front page
- **Then** «AC-4: Today» says «Today at» and its start time, and «AC-1: Coming» says tomorrow's date

**Automated:** none

## AC-5: An event going on now

WHILE an event is going on, the front page SHALL keep it under «Upcoming events» and mark it «Happening now».

**Test**

- **Given** «AC-5: Going on now»
- **When** you open the front page
- **Then** it is under «Upcoming events», marked «Happening now», and «AC-1: Coming» isn't

**Automated:** none

## AC-6: Your own sign-ups are marked

WHERE the person reading has signed up for an upcoming event, as a member or as a guest in the same browser, the front page SHALL mark it «You're signed up».

**Test**

- **Given** «AC-6: Signed up», with bob signed up, and a guest signed up in a private window
- **When** bob opens the front page, and the guest opens it in the same private window
- **Then** both see «You're signed up» on «AC-6: Signed up», and not on «AC-1: Coming»
- **When** you close every private window, and open the front page in a new one
- **Then** «AC-6: Signed up» isn't marked

**Automated:** none

## AC-7: Past events six at a time

The front page SHALL show past events as cards with their cover image, six at first, and six more each time **Show more events** is clicked, until none are left.

**Test**

- **Given** the seven «AC-7: Past …» events
- **When** you open http://localhost:5173/?tag=Past%207, so that only they show
- **Then** six cards show, each with its cover, and **Show more events** under them
- **When** you click **Show more events**
- **Then** the seventh shows, and the button is gone

**Automated:** none

## AC-8: Nothing to show

IF nothing has been published, or nothing is coming up, THEN the front page SHALL say so: «Nothing has been published yet.» or «Nothing coming up right now.»

The development database has events from earlier tests, so this one is tested on a test server ([OPS-07](OPS-07-test-servers.md)), which starts with a database of its own.

**Test**

- **Given** a test server started with `PORT=8801 mise exec -- pnpm test-server`
- **When** you open http://localhost:8801
- **Then** it says «Nothing has been published yet.»
- **When** you publish one event that is over, at http://localhost:8801/studio, and reload
- **Then** it says «Nothing coming up right now.», with the event under «Past events»

**Automated:** none
