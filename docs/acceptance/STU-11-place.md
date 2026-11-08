# STU-11: An event has a place

An event's place is required to publish it, and it follows the event into its page, its calendar invitations and its emails.

**Events:** one public event with a place, «AC-1 to AC-6: With a place». Sign up `bob@example.com` to it.

## AC-1: The place is written as free text

The studio SHALL let an organiser write an event's place as free text.

**Test**

- **Given** the event open in the studio
- **When** you write a place in **Place**, such as «Kantina, 5th floor»
- **Then** it stays as written, with no list to pick from

**Automated:** `packages/app/e2e/specs/site/site.spec.ts`

## AC-2: No place, no publishing

IF an event has no place, THEN Skjera SHALL refuse to publish it, naming the place among what is missing.

**Test**

- **Given** a new event in the studio with a title and a time, but no place
- **When** you click **Publish**
- **Then** it isn't published, and the message names the place among what to add

**Automated:** `packages/app/e2e/specs/studio/collaboration.spec.ts`, `packages/documents/test/events/publishing.test.ts`, `packages/documents/test/api/Problems.test.ts`

## AC-3: The event page shows the place

The event page SHALL show the event's place.

**Test**

- **Given** the event, published with a place
- **When** you open it on the site
- **Then** the place is shown with the time

**Automated:** `packages/app/e2e/specs/site/site.spec.ts`

## AC-4: Calendar invitations carry the place

Every calendar invitation Skjera sends for an event SHALL carry the event's place as its location.

**Test**

- **Given** bob signed up to the event
- **When** you open the invitation attached to his email in Mailpit (`.ics`)
- **Then** `LOCATION` is the event's place

**Automated:** `packages/app/e2e/specs/attendance/emails.spec.ts`, `packages/documents/test/site/Calendar.test.ts`, `packages/documents/test/notices/signups.test.tsx`, `packages/documents/test/notices/changes.test.tsx`

## AC-5: A new place is emailed

WHEN a published event is published again with another place, Skjera SHALL email those signed up with the new place and an updated calendar invitation, as it does when the time changes.

**Test**

- **Given** bob signed up to the event
- **When** you change the place in the studio and click **Publish**
- **Then** bob gets «New place: …», with the new place and the old one, and an invitation with the new location

**Automated:** `packages/app/e2e/specs/attendance/emails.spec.ts`, `packages/documents/test/notices/changes.test.tsx`, `packages/documents/test/events/notices.test.ts`

## AC-6: A new time and place in one email

WHEN one publication changes both an event's time and its place, Skjera SHALL send those signed up one email that tells of both.

**Test**

- **Given** bob signed up to the event
- **When** you change both the start time and the place in the studio, and click **Publish** once
- **Then** bob gets one new email, «New time and place: …», not two

**Automated:** `packages/app/e2e/specs/attendance/emails.spec.ts`, `packages/documents/test/notices/changes.test.tsx`, `packages/documents/test/events/notices.test.ts`

## AC-7: Events published without a place stay published

IF an event published before this change has no place, THEN Skjera SHALL keep it published and show its page without a place.

**Automated only:** no event without a place can be published now. `packages/documents/test/server/Sync.test.ts`, `packages/documents/test/site/PublicEvents.test.ts`
