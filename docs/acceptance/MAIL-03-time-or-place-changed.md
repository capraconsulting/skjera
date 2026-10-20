# MAIL-03: Email when the time or place changes

Those signed up are emailed when an event is published again at another time. A new place is emailed the same way, and a new time and place come in one email: see STU-11 AC-5 and AC-6. The organiser's own subject and text are in MAIL-06.

**Events:** «AC-1 to AC-5: Moved», public and open to guests. Sign up bob, and one guest in a private window.

## AC-1: A new time is emailed

WHEN a published event is published again with another start or end time, Skjera SHALL email everyone signed up «New time: <title>».

**Test**

- **Given** «Moved», with bob and the guest signed up
- **When** you change **Start time** in the studio, click **Publish**, and answer OK to «Publish the new time? The 2 people signed up are emailed about it.»
- **Then** bob and the guest each get «New time: AC-1 to AC-5: Moved» in Mailpit

**Automated:** `packages/app/e2e/specs/attendance/emails.spec.ts`, `packages/documents/test/events/notices.test.ts`, `packages/documents/test/notices/changes.test.tsx`

## AC-2: It gives the new time and the old one

The email about a new time SHALL give both the new time and the time before.

**Test**

- **Given** bob's email from AC-1
- **When** you read it
- **Then** it says «AC-1 to AC-5: Moved, which you're signed up for, has moved. It's now …» with the new time, and «It was …» with the old one

**Automated:** `packages/app/e2e/specs/attendance/emails.spec.ts`, `packages/documents/test/notices/changes.test.tsx`

## AC-3: An updated invitation

The email about a new time SHALL carry a calendar invitation with the new time, which updates the event in the calendar.

**Test**

- **Given** bob's email from AC-1
- **When** you open the invitation attached to it (`.ics`)
- **Then** it has `METHOD:REQUEST`, the new start in `DTSTART`, and the same `UID` as the invitation in his «You're signed up: …» email

**Automated:** `packages/app/e2e/specs/attendance/emails.spec.ts`, `packages/documents/test/notices/changes.test.tsx`

## AC-4: It says how to cancel

The email about a new time SHALL tell a member to cancel on the event's page, and a guest to cancel by their own link.

The guest's link itself is in SIGN-04 AC-4.

**Test**

- **Given** the emails from AC-1
- **When** you read them
- **Then** bob's says «Can't make it now? You can cancel your signup on the event's page.», with **See the event**
- **And** the guest's says «Can't make it now? Your own link cancels your signup.», with **Your signup**

**Automated:** none

## AC-5: Other changes send no email

IF an event is published again with neither its time nor its place changed, THEN Skjera SHALL email no one about it.

**Test**

- **Given** «Moved», with bob and the guest signed up
- **When** you change only the title in the studio and click **Publish**
- **Then** you are asked nothing, and no new email arrives in Mailpit for bob or the guest

**Automated:** `packages/documents/test/events/notices.test.ts`

## AC-6: Each change is emailed once

Skjera SHALL email each person signed up once about each change, however often the server tries to send it.

**Automated only:** the same change is only sent twice when the server retries it. `packages/documents/test/notices/changes.test.tsx`
