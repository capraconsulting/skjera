# SIGN-04: A guest's own link to their signup

A guest's emails carry a link of their own, which brings their signup to any browser, to change or cancel it there.

**Events:** one public event open to guests.

## AC-1: The link is in the email

WHEN a guest signs up, the confirmation email SHALL carry a link to their own signup.

**Test**

- **Given** the event
- **When** a guest signs up in a private window
- **Then** the email «You're signed up: …» in Mailpit has the button **Your signup**, and says «Your own link changes or cancels your signup until …»

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/documents/test/notices/signups.test.tsx`

## AC-2: The link opens the signup in another browser

WHEN a guest opens their link in another browser, the event page SHALL show them as signed up there, and take the link's details out of the address bar.

**Test**

- **Given** a guest signed up, with the email in Mailpit
- **When** **Your signup** is opened in a new private window
- **Then** the page says «You're signed up.», and the address ends with the event's id, with nothing after it

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`

## AC-3: The guest cancels from there

WHILE a guest has opened their link and sign-up is open, Skjera SHALL let them cancel their signup in that browser.

**Test**

- **Given** a guest's link opened in a new private window
- **When** the guest clicks **Cancel my signup** there
- **Then** the form is back, the studio's **Attendees** no longer lists the guest, and the email «Signup cancelled: …» arrives

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/documents/test/notices/signups.test.tsx`

## AC-4: Later emails carry it too

WHEN Skjera emails a guest about an event they are signed up for, the email SHALL carry the same link.

**Test**

- **Given** a guest signed up
- **When** you move the event to another day in the studio, **Publish**, and say yes when asked whether to email those signed up
- **Then** the email «New time: …» to the guest has a link to their signup, and opening it in a new private window says «You're signed up.»

**Automated:** `packages/documents/test/notices/changes.test.tsx`, `packages/documents/test/notices/texts.test.tsx`

## AC-5: Members get no such link

Skjera SHALL send members a link to the event's page, not a link of their own.

**Test**

- **Given** the event
- **When** bob signs up
- **Then** his email has the button **See the event**, leading to the event's page

**Automated:** `packages/documents/test/notices/signups.test.tsx`, `packages/documents/test/notices/changes.test.tsx`

## AC-6: The link can't be made up

IF a link carries a token that was not given for that signup, THEN Skjera SHALL NOT let it change or cancel the signup.

**Automated only:** a token is checked by the server, and a made-up one can't be shown wrong by hand. `packages/documents/test/attendance/signups.test.ts`, `packages/documents/test/attendance/guests.test.ts`
