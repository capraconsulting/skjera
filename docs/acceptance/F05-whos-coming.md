# F05: Who's coming

Members logged in see who has signed up, members and guests apart. Others see only how many.

**Events:** one public event open to guests, with bob and one guest signed up. One more, open to guests, with nobody signed up.

## AC-1: Members' names, with their count

WHILE a member is logged in, the event page SHALL show the names of the members signed up for the event, with their count in the list's heading.

**Test**

- **Given** the event with bob and a guest signed up
- **When** alice opens it on the site
- **Then** «Who's coming» has «Members (1)», listing bob

**Automated:** `packages/app/e2e/specs/attendance/whos-coming.spec.ts`

## AC-2: Guests in a list of their own

WHERE an event is open to guests, the event page SHALL show a logged-in member the names of the guests signed up, in a list of their own, with their count in its heading.

**Test**

- **Given** the same event
- **When** alice opens it
- **Then** «Guests (1)» lists the guest, apart from the members

**Automated:** `packages/app/e2e/specs/attendance/whos-coming.spec.ts`

## AC-3: An empty list says so

IF no one of a kind has signed up, THEN the event page SHALL say so in that kind's list.

**Test**

- **Given** the event nobody has signed up for
- **When** alice opens it
- **Then** it says «No members have signed up yet.» and «No guests have signed up yet.»

**Automated:** `packages/app/e2e/specs/attendance/whos-coming.spec.ts`

## AC-4: Not logged in, only the count

WHILE no one is logged in, the event page SHALL show only how many are coming, as it does today.

**Test**

- **Given** the event with bob and a guest signed up
- **When** it is opened in a private window
- **Then** it says «2 attending», with no names

**Automated:** `packages/app/e2e/specs/attendance/whos-coming.spec.ts`

## AC-5: No names reach a browser not logged in

IF a browser is not logged in, THEN Skjera SHALL NOT send it the names of those signed up, by the page or by any API.

**Test**

- **Given** the event with bob signed up, and the developer tools' **Network** tab open in a private window
- **When** the event is reloaded, and the responses are searched for bob's name
- **Then** it isn't in any of them

**Automated:** `packages/app/e2e/specs/attendance/whos-coming.spec.ts`, `packages/documents/test/server/Sync.test.ts`, `packages/documents/test/attendance/guests.test.ts`

## AC-6: The lists follow sign-ups live

WHEN someone signs up or cancels, the lists SHALL show the change without the page being reloaded, as the count does today.

**Test**

- **Given** the event open as alice
- **When** a new guest signs up in a private window, and then cancels
- **Then** alice's list gains and loses the guest without a reload

**Automated:** `packages/app/e2e/specs/attendance/whos-coming.spec.ts`
