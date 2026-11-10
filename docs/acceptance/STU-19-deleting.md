# STU-19: Deleting an event

An organiser deletes an event with **Delete** in the studio. It leaves the studio and the site at once, and those signed up to a coming event are told it is cancelled. The question before deleting is the studio's own dialog, answered with **Delete** or **Cancel**.

**Events:** in team «STU-19: Deleting an event», public events open to guests:

- «AC-1: Not published», never published.
- «AC-2 to AC-5: Signed up», published, starting tomorrow, with bob and one guest signed up.
- «AC-6: Ended», published, starting in a few minutes and ending a few minutes later, with one guest signed up before it starts.

## AC-1: Asked before deleting

WHEN an organiser clicks **Delete**, the studio SHALL ask first, and SHALL keep the event if the answer is no.

**Test**

- **Given** «AC-1: Not published» open in the studio
- **When** you click **Delete**
- **Then** the studio asks «Delete this event? It is also taken off the site.»
- **When** you click **Cancel**
- **Then** the event is still open and listed in the team

**Automated:** `packages/app/e2e/specs/studio/collaboration.spec.ts`

## AC-2: The question says who is told

WHERE a published event that has not ended has signed-up people who can be emailed, the question SHALL say they are emailed that it is cancelled, and how many are emailed.

**Test**

- **Given** «AC-2 to AC-5: Signed up» open in the studio
- **When** you click **Delete**
- **Then** the studio asks «Delete this event? It's taken off the site, and the 2 people signed up are emailed that it's cancelled.»
- **When** you click **Cancel**
- **Then** the event is still there, for AC-3

**Automated:** `packages/documents/test/events/notices.test.ts`, `packages/app/test/studio/attendeeNotices.test.ts`, `packages/app/e2e/specs/attendance/emails.spec.ts`

## AC-3: Gone from the studio and the site

WHEN an event is deleted, Skjera SHALL take it out of the studio and off the site at once.

**Test**

- **Given** «AC-2 to AC-5: Signed up», open on the site in a private window, and in the studio as bob
- **When** alice clicks **Delete** and confirms with **Delete**
- **Then** it leaves the team's list, and the site's page, reloaded, says «This event doesn't exist, or isn't published.»

**Automated:** `packages/app/e2e/specs/attendance/emails.spec.ts`, `packages/app/e2e/specs/site/site.spec.ts`, `packages/documents/test/events/drafts.test.ts`, `packages/documents/test/events/notices.test.ts`

## AC-4: Others with it open are told

WHEN an event is deleted, the studio SHALL tell other organisers with it open that it was deleted.

**Test**

- **Given** the deletion in AC-3
- **When** you look at bob's studio, without reloading
- **Then** it says «This event was deleted.» in place of the event

**Automated:** `packages/app/e2e/specs/studio/collaboration.spec.ts`

## AC-5: Those signed up are told it's cancelled

WHEN an event that has not ended is deleted, Skjera SHALL email everyone signed up that it is cancelled, with a cancellation for their calendar.

**Test**

- **Given** the deletion in AC-3
- **When** you open Mailpit
- **Then** bob and the guest each have «Cancelled: AC-2 to AC-5: Signed up», with a calendar cancellation attached (`.ics`, `METHOD:CANCEL`)

**Automated:** `packages/app/e2e/specs/attendance/emails.spec.ts`, `packages/documents/test/events/notices.test.ts`, `packages/documents/test/notices/changes.test.tsx`

## AC-6: An event that has ended goes quietly

IF an event has ended when it is deleted, THEN Skjera SHALL email nobody, and the question SHALL not say anyone is emailed.

**Test**

- **Given** «AC-6: Ended», after it has ended, open in the studio
- **When** you click **Delete**
- **Then** the studio asks «Delete this event? It is also taken off the site.»
- **When** you confirm with **Delete**
- **Then** the guest gets no «Cancelled: …» in Mailpit

**Automated:** `packages/documents/test/events/notices.test.ts`

## AC-7: A deleted event is kept, marked deleted

WHEN an event is deleted, Skjera SHALL keep it in the database, marked as deleted and by whom, and refuse any sign-up to it.

**Automated only:** nothing of it can be seen in the app. `packages/documents/test/events/notices.test.ts`

## AC-8: A refused deletion

IF the server refuses to delete an event, THEN the studio SHALL say «Deleting the event failed», keep the event open and leave its contents unchanged.

**Automated only:** refusing the server request cannot be brought about through the studio. `packages/app/e2e/specs/studio/teams.spec.ts`
