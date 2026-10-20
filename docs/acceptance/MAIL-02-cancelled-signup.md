# MAIL-02: Email when you cancel

Someone who cancels their sign-up gets an email saying so, with a cancellation that takes the event out of their calendar. The organiser's own subject and text are in MAIL-06.

**Events:** «AC-1 to AC-3: Cancelled signup», public and open to guests.

## AC-1: An email when you cancel

WHEN a member or a guest cancels their sign-up, Skjera SHALL email them «Signup cancelled: <title>».

**Test**

- **Given** «Cancelled signup»
- **When** bob clicks **Attend** and then **Cancel attendance**, and a guest in a private window signs up and clicks **Cancel my signup**
- **Then** each gets «Signup cancelled: AC-1 to AC-3: Cancelled signup» in Mailpit, saying «You're no longer signed up for AC-1 to AC-3: Cancelled signup, …» with the day and the time

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/documents/test/notices/signups.test.tsx`

## AC-2: It takes the event out of the calendar

The email about a cancelled sign-up SHALL carry a calendar cancellation of the event.

**Test**

- **Given** bob's email from AC-1
- **When** you open the cancellation attached to it (`.ics`)
- **Then** it has `METHOD:CANCEL`, and the same `UID` as the invitation in his «You're signed up: …» email

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/documents/test/notices/signups.test.tsx`, `packages/documents/test/site/Calendar.test.ts`

## AC-3: It says how to sign up again

The email about a cancelled sign-up SHALL say that the person can sign up again on the event's page while sign-up is open, and link to the page.

**Test**

- **Given** bob's email from AC-1
- **When** you read it, and click **See the event**
- **Then** it says «Changed your mind again? You can sign up on the event's page while sign-up is open.», and the button opens the event's page

**Automated:** none
