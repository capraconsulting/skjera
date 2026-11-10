# EXT-01: Calendar invitations that calendar apps understand

The emails about a sign-up carry a calendar invitation, or a cancellation, that calendar apps add, update or remove. The place in it is in STU-11 AC-4, the summary in SITE-08 AC-3, the team as organiser in STU-02 AC-5, and the calendar to subscribe to in EXT-02.

**Events:** «AC-1 to AC-7: Invited», public and open to guests. Sign up bob; then change **Start time** in the studio, click **Publish** and confirm with **Publish**; then cancel bob's sign-up with **Cancel attendance**. That gives three emails in Mailpit: «You're signed up: …», «New time: …» and «Signup cancelled: …».

## AC-1: One id for the event

Every invitation and cancellation Skjera sends for an event SHALL carry the same id, so a calendar updates or removes the event it has rather than adding a copy.

**Test**

- **Given** bob's three emails
- **When** you open the file attached to each (`.ics`)
- **Then** all three have the same `UID`

**Automated:** `packages/documents/test/site/Calendar.test.ts`, `packages/documents/test/notices/signups.test.tsx`

## AC-2: A newer version replaces the older

WHEN an event has been published again, each invitation Skjera sends for it SHALL carry a higher sequence number than those sent before.

**Test**

- **Given** bob's three emails
- **When** you compare `SEQUENCE` in the invitation of «You're signed up: …» and of «New time: …»
- **Then** the one in «New time: …» is higher

**Automated:** `packages/documents/test/notices/changes.test.tsx`

## AC-3: Times in UTC

Every invitation SHALL give the event's start and end in UTC.

**Test**

- **Given** bob's «You're signed up: …»
- **When** you open the invitation
- **Then** `DTSTART` and `DTEND` end in `Z`, and are the event's times in UTC: 18:00 in Oslo in summer time is `160000Z`

**Automated:** `packages/documents/test/site/Calendar.test.ts`, `packages/documents/test/notices/signups.test.tsx`, `packages/documents/test/notices/changes.test.tsx`

## AC-4: Already attending, no reply asked

Every invitation SHALL list the person as attending, and ask for no reply, as sign-up and cancelling happen on the site.

**Test**

- **Given** bob's «You're signed up: …»
- **When** you open the invitation
- **Then** `ATTENDEE` has bob's name and email, `PARTSTAT=ACCEPTED` and `RSVP=FALSE`

**Automated:** `packages/documents/test/site/Calendar.test.ts`

## AC-5: The title and the event's page

Every invitation SHALL carry the event's title, and a link to its event page.

**Test**

- **Given** bob's «You're signed up: …»
- **When** you open the invitation
- **Then** `SUMMARY` is the title, `URL` is the event's page, and `DESCRIPTION` ends with the same link

**Automated:** `packages/documents/test/site/Calendar.test.ts`, `packages/documents/test/notices/signups.test.tsx`

## AC-6: A cancelled sign-up is cancelled for that person only

WHEN a person cancels their sign-up, the cancellation SHALL take the event out of their calendar without marking the event as cancelled.

A cancelled event is marked as cancelled: see MAIL-04 AC-2.

**Test**

- **Given** bob's «Signup cancelled: …»
- **When** you open the cancellation
- **Then** it has `METHOD:CANCEL`, and no `STATUS:CANCELLED`

**Automated:** `packages/documents/test/site/Calendar.test.ts`

## AC-7: The organiser's address is the site's

Every invitation SHALL give as the organiser's address the address Skjera's emails come from.

**Test**

- **Given** bob's «You're signed up: …»
- **When** you open the invitation
- **Then** `ORGANIZER` ends with `mailto:events@skjera.localhost`, the address the email came from

**Automated:** `packages/documents/test/notices/organizer.test.tsx`, `packages/documents/test/site/Calendar.test.ts`
