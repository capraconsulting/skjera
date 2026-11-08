# STU-20: Unpublishing an event

An organiser takes a published event off the site with **Unpublish** in the studio and keeps it there as a draft, to edit and publish again. Those signed up to a coming event are told it is cancelled. The question before unpublishing is the browser's own, answered with **OK** or **Cancel**.

**Events:** in team «STU-20: Unpublishing», public events open to guests:

- «AC-1: Not published», never published.
- «AC-3 to AC-14: Signed up», published, starting tomorrow, with bob and one guest signed up.
- «AC-1 to AC-3: Nobody signed up», published, starting tomorrow, with no one signed up.
- «AC-8 to AC-11: Ended», published, starting in a few minutes and ending a few minutes later, with one guest signed up before it starts.
- «AC-10: Weekly», published, repeating every week, and ended.

## AC-1: Unpublish is offered on a published event

WHILE an event is published, the studio SHALL show an **Unpublish** button to the organisers who may delete it.

**Test**

- **Given** «AC-1: Not published» open in the studio
- **Then** there is no **Unpublish** button
- **When** you open «AC-1 to AC-3: Nobody signed up»
- **Then** there is an **Unpublish** button

**Automated:** `packages/app/e2e/specs/unpublishing.spec.ts`

## AC-2: Asked before unpublishing

WHEN an organiser clicks **Unpublish**, the studio SHALL ask first, and SHALL keep the event published if the answer is no.

**Test**

- **Given** «AC-1 to AC-3: Nobody signed up» open in the studio
- **When** you click **Unpublish** and then **Cancel**
- **Then** the event still says it is published, also after you reload the page

**Automated:** `packages/app/e2e/specs/unpublishing.spec.ts`

## AC-3: The question says who is told

WHERE a published event that has not ended has signed-up people who can be emailed, the question SHALL say they are emailed that it is cancelled, and how many are emailed.

**Test**

- **Given** «AC-3 to AC-14: Signed up» open in the studio
- **When** you click **Unpublish**
- **Then** the browser asks «Unpublish this event? It's taken off the site and kept here as a draft, and the 2 people signed up are emailed that it's cancelled.»
- **When** you click **Cancel**
- **Then** the event is still published, for AC-4
- **Given** «AC-1 to AC-3: Nobody signed up» open in the studio
- **When** you click **Unpublish**
- **Then** the browser asks «Unpublish this event? It's taken off the site and kept here as a draft.»

**Automated:** `packages/documents/test/events/notices.test.ts`, `packages/app/test/attendeeNotices.test.ts`, `packages/app/e2e/specs/unpublishing.spec.ts`

## AC-4: Off the site at once

WHEN an event is unpublished, Skjera SHALL take it off the front page, the event page, `/embed`, `/api/public/events` and `/api/subscribe` at once.

**Test**

- **Given** «AC-3 to AC-14: Signed up», open on the site in a private window
- **When** alice clicks **Unpublish** and **OK**
- **Then** the event is gone from the front page, `/embed`, `/api/public/events` and the calendar subscription `/api/subscribe`
- **And** the event's page, reloaded, no longer shows it, for AC-14

**Automated:** `packages/documents/test/events/publishing.test.ts`, `packages/documents/test/site/PublicEvents.test.ts`, `packages/documents/test/site/Embed.test.ts`, `packages/documents/test/site/CalendarFeed.test.ts`, `packages/documents/test/site/Sharing.test.ts`

## AC-5: No sign-up to an unpublished event

IF someone tries to sign up to an unpublished event, THEN Skjera SHALL refuse the sign-up.

**Test**

- **Given** the unpublished event of AC-4, and a guest who had its sign-up form open
- **When** the guest fills in the form and clicks **Sign up**
- **Then** the sign-up is refused and nobody is added

**Automated:** `packages/documents/test/events/publishing.test.ts`

## AC-6: Kept as a draft

WHEN an event is unpublished, Skjera SHALL keep it in the studio as a draft with all its content, marked as not published.

**Test**

- **Given** the unpublished event of AC-4, open in the studio
- **Then** the footer says «Not published», its title and text are still there, and the team's list shows it as «Draft»

**Automated:** `packages/app/e2e/specs/unpublishing.spec.ts`, `packages/documents/test/events/publishing.test.ts`

## AC-7: Those signed up are told it's cancelled

WHEN an event that has not ended is unpublished, Skjera SHALL email everyone signed up that it is cancelled, with a cancellation for their calendar, once each, and remove their signups.

**Test**

- **Given** the unpublished event of AC-4
- **When** you open Mailpit
- **Then** bob and the guest each have one «Cancelled: AC-3 to AC-14: Signed up», with a calendar cancellation attached (`.ics`, `METHOD:CANCEL`)
- **And** when the event is open in the studio, its attendee list is empty

**Automated:** `packages/documents/test/events/notices.test.ts`, `packages/app/e2e/specs/unpublishing.spec.ts`

## AC-8: An event that has ended goes quietly

IF an event has ended when it is unpublished, THEN Skjera SHALL email nobody, keep its signups, and the question SHALL not say anyone is emailed.

**Test**

- **Given** «AC-8 to AC-11: Ended», after it has ended, open in the studio
- **When** you click **Unpublish**
- **Then** the browser asks «Unpublish this event? It's taken off the site and kept here as a draft.»
- **When** you click **OK**
- **Then** the guest gets no «Cancelled: …» in Mailpit

**Automated:** `packages/documents/test/events/notices.test.ts`

## AC-9: Others with it open are told

WHEN an event is unpublished, the studio SHALL show other organisers with it open that it is no longer published.

**Test**

- **Given** «AC-3 to AC-14: Signed up» open in the studio as alice and as bob
- **When** alice clicks **Unpublish** and **OK**
- **Then** bob's footer, without reloading, says «Not published» and the **Unpublish** button is gone

**Automated:** `packages/app/e2e/specs/unpublishing.spec.ts`

## AC-10: Not moved on, not posted to Slack

WHILE an event is unpublished, Skjera SHALL not move it on to its next date and SHALL not post its sign-up deadline to Slack.

**Test**

- **Given** «AC-10: Weekly», ended, and the weekly job run after its end
- **When** you unpublish it before the job runs
- **Then** its start and end are the same after the job as before
- **And** no sign-up deadline for it is posted to the Slack channel

**Automated:** `packages/documents/test/events/recurring/moving.test.ts`, `packages/documents/test/notices/SlackChannel.test.ts`

## AC-11: Published again

WHEN an unpublished event is published again, Skjera SHALL show it on the site with no one signed up, and SHALL not post it to Slack again.

**Test**

- **Given** the unpublished event of AC-4, open in the studio
- **When** you change its title and click **Publish**
- **Then** the site shows the event with the new title, and no one is signed up
- **And** the Slack channel gets no new post about it
- **Given** «AC-8 to AC-11: Ended», unpublished
- **When** you publish it again
- **Then** it comes back with the signup it kept, since its signups were not removed

**Automated:** `packages/documents/test/events/publishing.test.ts`, `packages/app/e2e/specs/unpublishing.spec.ts`

## AC-12: In three languages

The studio SHALL show the **Unpublish** button, its question and the event's status in English, Bokmål and Nynorsk.

**Test**

- **Given** «AC-3 to AC-14: Signed up» open in the studio
- **When** you switch the language to Bokmål and then Nynorsk
- **Then** the button, its question and the status «Ikke publisert» / «Ikkje publisert» are in that language

**Automated:** `packages/i18n/test/messages.test.ts`

## AC-13: This page

The acceptance docs SHALL describe unpublishing, with a manual test for each criterion and the automated tests that check it.

**Automated only:** no test reads the acceptance docs. This page is the check.

## AC-14: The link of an unpublished event

IF someone opens the link of an unpublished event, THEN Skjera SHALL show the page an event that is gone shows today.

**Test**

- **Given** the unpublished event of AC-4
- **When** you open its page on the site
- **Then** it says «This event doesn't exist, or isn't published.»

**Automated:** `packages/app/e2e/specs/unpublishing.spec.ts`

## AC-15: Each person is told once

IF the server stops part way through the cancellation emails, THEN Skjera SHALL send no one a second cancellation email when it resumes.

**Automated only:** nothing of it can be seen in the app. `packages/documents/test/events/notices.test.ts`, and `packages/documents/test/server/Cluster.test.ts` for a notice kept through a server restart.
