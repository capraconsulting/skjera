# MAIL-01: Confirmation email when you sign up

Everyone who signs up for an event gets an email saying so, with the event as a calendar invitation. A guest's own link in it is in SIGN-04, what the invitation carries in EXT-01, and the organiser's own subject and text in MAIL-06.

**Events:**

- «AC-1 to AC-4: Signed up», public and open to guests, with **Food is served** ticked and a **Sign-up deadline** the day before it starts.
- «AC-5: Refused», public and open to guests.

## AC-1: An email for each sign-up

WHEN a member or a guest signs up for an event, Skjera SHALL email them «You're signed up: <title>», saying when the event is, with a calendar invitation attached.

**Test**

- **Given** «Signed up»
- **When** bob clicks **Attend**, and a guest signs up with **Sign up** in a private window
- **Then** each gets «You're signed up: AC-1 to AC-4: Signed up» in Mailpit, saying «You're signed up for AC-1 to AC-4: Signed up, …» with the day, the time and the time zone
- **And** each email has an invitation attached (`.ics`)

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/documents/test/notices/signups.test.tsx`

## AC-2: It says when food is served

WHERE food is served at an event, the confirmation email SHALL say «Food is served.»

**Test**

- **Given** bob's email from AC-1
- **When** you read it
- **Then** it says «Food is served.»

**Automated:** `packages/documents/test/notices/signups.test.tsx`

## AC-3: It says until when to change your mind

The confirmation email SHALL say until when the sign-up can be changed or cancelled: the sign-up deadline, or the start when there is none.

**Test**

- **Given** bob's email from AC-1
- **When** you read it
- **Then** it says «Changed your mind? You can change or cancel your signup on the event's page until …», followed by the sign-up deadline

**Automated:** none

## AC-4: It says why it came

The confirmation email SHALL end by saying why it was sent.

**Test**

- **Given** bob's email from AC-1
- **When** you read the end of it
- **Then** it says «You signed up for AC-1 to AC-4: Signed up on Skjera.»

**Automated:** none

## AC-5: No email for a refused sign-up

IF Skjera refuses a sign-up, THEN Skjera SHALL send no email about it.

**Test**

- **Given** «Refused», with a guest signed up as `gina1@example.org`
- **When** another guest, in a new private window, signs up with the same email
- **Then** it is refused with «That email is already signed up for this event», and Mailpit has only the one «You're signed up: AC-5: Refused» to that address

**Automated:** `packages/documents/test/notices/organizer.test.tsx`
