# F03: Streaming, in person or online

An event can be streamed. Those signing up then say whether they come in person or follow online, and only those in person take a place.

**Events:** public events open to guests, with **The event is streamed** ticked, one per criterion below.

## AC-1: Streaming is set in the studio

The studio SHALL let an organiser mark an event as streamed and give the link to the stream.

**Test**

- **Given** an event open in the studio
- **When** you tick **The event is streamed** and write an address in **Link to the stream**
- **Then** both are kept

**Automated:** `packages/app/e2e/specs/attendance/streaming.spec.ts`, `packages/documents/test/events/content.test.ts`

## AC-2: Everyone sees the link

WHERE an event is streamed, the event page SHALL show the link to the stream to everyone who can see the page.

**Test**

- **Given** a streamed event without a link
- **When** you open it on the site
- **Then** it only says «Streamed»
- **When** you write a link starting with `https://` in the studio, **Publish**, and open the event as bob and in a private window
- **Then** the link is shown under «Streamed» to both, also to the window that isn't logged in

**Automated:** `packages/app/e2e/specs/attendance/streaming.spec.ts`, `packages/documents/test/events/content.test.ts`

## AC-3: In person or online must be chosen

WHERE an event is streamed, Skjera SHALL ask everyone signing up, as a member or a guest, whether they attend in person or online, and SHALL refuse a sign-up without an answer.

**Test**

- **Given** a streamed event
- **When** bob, and a guest in a private window, open it
- **Then** both are asked «How will you attend?», with neither choice made beforehand
- **When** they try to sign up without choosing
- **Then** the sign-up doesn't go through, until one is chosen

**Automated:** `packages/app/e2e/specs/attendance/streaming.spec.ts`, `packages/documents/test/attendance/streaming.test.ts`

## AC-4: The choice can be changed until sign-up closes

WHERE an event is streamed, Skjera SHALL let those signed up change between in person and online until sign-up closes.

**Test**

- **Given** bob signed up in person to a streamed event
- **When** he chooses **Online** with **Change answers** and **Save changes**, and then in person again
- **Then** each change is kept

**Automated:** `packages/app/e2e/specs/attendance/streaming.spec.ts`, `packages/documents/test/attendance/streaming.test.ts`

## AC-5: Attendees and the spreadsheet show how each comes

The studio's list of attendees and the exported spreadsheet SHALL show, for a streamed event, whether each attendee comes in person or online.

**Test**

- **Given** bob signed up in person and a guest online
- **When** you look at **Attendees** in the studio, and **Download CSV**
- **Then** both show «In person» for bob and «Online» for the guest

**Automated:** `packages/app/e2e/specs/attendance/streaming.spec.ts`

## AC-6: Only those in person count against the limit

WHERE an event is streamed and has a maximum number of attendees, the limit SHALL count only those attending in person, and Skjera SHALL accept online sign-ups when the event is full.

**Test**

- **Given** a streamed event with **Maximum attendees** 2, with bob and a guest signed up in person
- **When** alice opens it on the site
- **Then** it says «There are no more places in person. You can still follow online.», the choice reads «In person (full)», dimmed and not selectable, and alice can sign up online

**Automated:** `packages/app/e2e/specs/attendance/streaming.spec.ts`, `packages/documents/test/attendance/streaming.test.ts`

## AC-7: Not streamed, everyone counts as in person

WHERE an event is not streamed, Skjera SHALL count every attendee as attending in person.

**Test**

- **Given** a streamed event with **Maximum attendees** 2, with bob and a guest signed up online
- **When** you untick **The event is streamed** in the studio and **Publish**
- **Then** both count as in person, and the event is full

**Automated:** `packages/app/e2e/specs/attendance/streaming.spec.ts`, `packages/documents/test/attendance/streaming.test.ts`
