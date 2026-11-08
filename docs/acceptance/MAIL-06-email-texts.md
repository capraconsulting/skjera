# MAIL-06: Each event's own email texts

An organiser can write each event's own subject and text for the emails it sends.

**Events:**

- «AC-2 to AC-5: Own texts», public and open to guests, with a subject and a text written for all four emails.
- «AC-4: Standard texts», with all of them left empty.
- «AC-6: Cancelled after an unpublished change», with a text for **Event cancelled email**, and bob signed up.

## AC-1: Subject and text for four emails

The studio shall let an organiser write, for each event, an optional subject and an optional text for the signed-up, sign-up-cancelled, event-changed and event-cancelled emails.

**Test**

- **Given** an event open in the studio
- **When** you open **Sign-up cancelled email**, **Event changed email** and **Event cancelled email** under **Emails**, with **Signed-up email** open already
- **Then** each has a subject and a text, both optional

**Automated:** `packages/app/e2e/specs/attendance/emails.spec.ts`, `packages/documents/test/events/emails.test.ts`

## AC-2: The email carries the subject written, then the event's title

When Skjera sends one of these four emails for an event whose organiser has written a subject for it, the email's subject shall be that subject, a space, and the event's title.

**Test**

- **Given** «Own texts»
- **When** bob signs up and cancels; signs up again; you change the time and **Publish**; and you delete the event
- **Then** each of the four emails to bob in Mailpit has the subject written for it, followed by a space and the event's title

**Automated:** `packages/app/e2e/specs/attendance/emails.spec.ts`, `packages/documents/test/notices/texts.test.tsx`

## AC-3: The text written replaces the standard wording

When Skjera sends one of these four emails for an event whose organiser has written a text for it, the email shall show that text in place of the standard wording.

**Test**

- **Given** the four emails from AC-2
- **When** you read them
- **Then** the text written stands where the standard wording would

**Automated:** `packages/app/e2e/specs/attendance/emails.spec.ts`, `packages/documents/test/notices/texts.test.tsx`

## AC-4: Empty fields, standard emails

If the organiser has left a subject or a text empty, then Skjera shall use the standard subject or wording in the recipient's language, as today.

**Test**

- **Given** «Standard texts»
- **When** bob signs up, and a guest signs up after picking Bokmål in the header
- **Then** bob's email has the standard English subject and text, «You're signed up: …», and the guest's the Bokmål one

**Automated:** `packages/app/e2e/specs/tooling/language.spec.ts`, `packages/documents/test/events/emails.test.ts`, `packages/documents/test/notices/signups.test.tsx`, `packages/documents/test/notices/texts.test.tsx`

## AC-5: Details, invitation and links stay

Each of these emails shall keep the event's details, its calendar invitation and its links, whatever subject and text the organiser has written.

**Test**

- **Given** the four emails from AC-2
- **When** you read them
- **Then** they still have the event's details, the invitation attached, and the links

**Automated:** `packages/app/e2e/specs/attendance/emails.spec.ts`, `packages/documents/test/notices/texts.test.tsx`

## AC-6: The published texts are used, not a draft's

When an event is changed or cancelled, the email shall use the subject and text the event had when it was published, not an unpublished draft's.

**Test**

- **Given** «Cancelled after an unpublished change», with bob signed up
- **When** you change the text of **Event cancelled email** without publishing, and delete the event
- **Then** bob's email has the text that was published, not the new one

**Automated:** `packages/app/e2e/specs/attendance/emails.spec.ts`, `packages/documents/test/notices/texts.test.tsx`

## AC-7: The signed-up email is open from the start

When an event is opened in the studio, the signed-up email's subject and text shall be shown open, and the sign-up cancelled, event changed and event cancelled emails shall be closed while nothing is written for them.

**Test**

- **Given** a published event with nothing written for its emails, the test data's Standard texts event among them
- **When** you open it in the studio
- **Then** the signed-up email's subject and text are shown, the other three emails are closed, and the footer still says «Published»; after you type in the signed-up subject, it no longer does

**Automated:** `packages/app/e2e/specs/attendance/emails.spec.ts`, `packages/app/test/studio/emailTexts.test.ts`
