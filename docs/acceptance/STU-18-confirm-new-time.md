# STU-18: Confirming a new time before publishing it

Publishing a new time or place for an event people have signed up for emails them, so the studio asks first. The question is the studio's own dialog, answered with **Publish** or **Cancel**.

**Events:** in team «STU-18: Confirming a new time before publishing it», public events open to guests, published with a time and a place:

- «AC-1 to AC-3: One signed up», with one guest signed up.
- «AC-4: Two signed up», with bob and one guest signed up.
- «AC-5: A new place», with one guest signed up.
- «AC-6: Nobody signed up».
- «AC-6: A new title», with one guest signed up.

## AC-1: Asked before a new time is published

WHEN an organiser publishes a new start or end for an event someone is signed up for, the studio SHALL first ask whether to publish it, saying those signed up are emailed.

**Test**

- **Given** «AC-1 to AC-3: One signed up» open in the studio
- **When** you change the start time and click **Publish**
- **Then** the studio asks «Publish the new time? The person signed up is emailed about it.»

**Automated:** `packages/app/e2e/specs/attendance/emails.spec.ts`

## AC-2: Saying no publishes nothing

IF the organiser answers no, THEN Skjera SHALL leave the event as it was published, email nobody, and keep **Publish** available.

**Test**

- **Given** the question from AC-1
- **When** you click **Cancel**
- **Then** **Publish** can still be clicked, the site still shows the old time, and the guest has no new email in Mailpit

**Automated:** `packages/app/e2e/specs/attendance/emails.spec.ts`

## AC-3: Saying yes publishes and emails

WHEN the organiser answers yes, Skjera SHALL publish the new time and email those signed up about it.

**Test**

- **Given** the question from AC-1
- **When** you confirm with **Publish**
- **Then** the site shows the new time, and the guest gets «New time: AC-1 to AC-3: One signed up» with the new time, the old one, and an updated invitation

**Automated:** `packages/app/e2e/specs/attendance/emails.spec.ts`, `packages/documents/test/notices/changes.test.tsx`, `packages/documents/test/events/notices.test.ts`

## AC-4: The question counts those who are emailed

WHERE more than one signed-up person can be emailed, the question SHALL say how many are emailed.

**Test**

- **Given** «AC-4: Two signed up» open in the studio
- **When** you change the start time and click **Publish**
- **Then** the studio asks «Publish the new time? The 2 people signed up are emailed about it.»

**Automated:** `packages/documents/test/events/notices.test.ts`, `packages/app/test/studio/attendeeNotices.test.ts`, `packages/app/e2e/specs/attendance/emails.spec.ts`

## AC-5: A new place is asked about too

WHEN an organiser publishes a new place, or a new time and place together, for an event someone is signed up for, the studio SHALL ask first, naming what is new.

**Test**

- **Given** «AC-5: A new place» open in the studio
- **When** you change the place and click **Publish**
- **Then** the studio asks «Publish the new place? The person signed up is emailed about it.»
- **When** you click **Cancel**, change the start time too, and click **Publish**
- **Then** it asks «Publish the new time and place? The person signed up is emailed about it.»

**Automated:** `packages/app/e2e/specs/attendance/emails.spec.ts`

## AC-6: No question when nobody is told

IF nobody is signed up, or only something other than the time and place has changed, THEN the studio SHALL publish without asking.

**Test**

- **Given** «AC-6: Nobody signed up» open in the studio
- **When** you change the start time and click **Publish**
- **Then** it is published at once, with no question
- **When** you open «AC-6: A new title», add a word to its title, and click **Publish**
- **Then** it is published at once, with no question, and the guest gets no email

**Automated:** `packages/app/e2e/specs/site/site.spec.ts`, `packages/documents/test/events/notices.test.ts`
