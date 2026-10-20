# MAIL-04: Email when the event is cancelled

When a published event is deleted before it has ended, everyone signed up is emailed that it is cancelled, with a cancellation for their calendar. The organiser's own subject and text, as they were published, are in MAIL-06.

**Events:**

- «AC-1 to AC-3: Cancelled», public and open to guests. Sign up bob, and one guest in a private window.
- «AC-4: Over», public and open to guests, starting in a few minutes and lasting a few minutes. Sign up bob before it starts.

## AC-1: Everyone signed up is told

WHEN a published event that has not ended is deleted, Skjera SHALL email everyone signed up «Cancelled: <title>».

**Test**

- **Given** «Cancelled», with bob and the guest signed up
- **When** you click **Delete** in the studio, and answer OK to «Delete this event? It's taken off the site, and the 2 people signed up are emailed that it's cancelled.»
- **Then** bob and the guest each get «Cancelled: AC-1 to AC-3: Cancelled» in Mailpit, saying «AC-1 to AC-3: Cancelled, …, which you signed up for, is cancelled.»

**Automated:** `packages/app/e2e/specs/attendance/emails.spec.ts`, `packages/documents/test/events/notices.test.ts`, `packages/documents/test/notices/changes.test.tsx`

## AC-2: The event is cancelled in the calendar

The email about a cancelled event SHALL carry a calendar cancellation that marks the event as cancelled.

**Test**

- **Given** bob's email from AC-1
- **When** you open the cancellation attached to it (`.ics`)
- **Then** it has `METHOD:CANCEL` and `STATUS:CANCELLED`

**Automated:** `packages/app/e2e/specs/attendance/emails.spec.ts`, `packages/documents/test/notices/changes.test.tsx`, `packages/documents/test/site/Calendar.test.ts`

## AC-3: No link to follow

The email about a cancelled event SHALL have no link to the event or to a guest's sign-up, as there is nothing left to see.

**Test**

- **Given** the guest's email from AC-1
- **When** you read it
- **Then** it has no button and no link to the event

**Automated:** `packages/documents/test/notices/changes.test.tsx`

## AC-4: No email for an event that has ended

IF an event is deleted after it has ended, THEN Skjera SHALL email no one about it.

**Test**

- **Given** «Over», with bob signed up, after it has ended
- **When** you click **Delete** in the studio
- **Then** the question is «Delete this event? It is also taken off the site.», and bob gets no «Cancelled: AC-4: Over»

**Automated:** `packages/documents/test/events/notices.test.ts`

## AC-5: Nothing more after the cancellation

IF an email about an event is still on its way when the event is deleted, THEN Skjera SHALL NOT send it, and send only the cancellation.

**Automated only:** it takes an email held up inside the server while the event is deleted. `packages/documents/test/notices/changes.test.tsx`
