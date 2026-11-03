# SIGN-02: Guests sign up with name and email

On a public event open to guests, people without an account sign up with their name and email. Phone and company are in SIGN-03.

**Events:** one public event with **Guests can sign up** ticked, and one public event without it.

## AC-1: The guest form

WHERE an event is open to guests, the event page SHALL offer a visitor who is not logged in a form with their name and email, and a link to log in instead.

**Test**

- **Given** the event open to guests
- **When** it is opened in a private window
- **Then** the sign-up box has «Your name», «Your email», **Sign up**, and «or log in»

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/app/e2e/specs/language.spec.ts`

## AC-2: A guest signs up

WHEN a guest sends the form with a name and an email, Skjera SHALL sign them up.

**Test**

- **Given** the event open to guests
- **When** a guest signs up in a private window with a name and a new email
- **Then** the page says «You're signed up.» and «1 attending», and the studio's **Attendees** lists the guest, marked **Guest**

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/documents/test/attendance/guests.test.ts`

## AC-3: The browser remembers

WHEN a guest has signed up, the browser they signed up in SHALL show them as signed up after a reload.

**Test**

- **Given** a guest signed up in a private window
- **When** the page is reloaded in that window
- **Then** it still says «You're signed up.», with **Cancel my signup**

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`

## AC-4: One sign-up per email

IF a guest signs up with an email already signed up for the event, in any mix of capital and small letters, THEN Skjera SHALL refuse it.

**Test**

- **Given** a guest signed up as `gina1@example.org`
- **When** another private window signs up with `GINA1@example.org`
- **Then** it is refused with «That email is already signed up for this event»

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/app/e2e/specs/language.spec.ts`, `packages/documents/test/attendance/guests.test.ts`

## AC-5: A guest cancels

WHILE a guest is signed up and sign-up is open, the event page SHALL offer **Cancel my signup** in the browser they signed up in, and clicking it SHALL take them off.

**Test**

- **Given** a guest signed up in a private window
- **When** the guest clicks **Cancel my signup**
- **Then** the form is back, the page says «Nobody has signed up yet.», and the studio's **Attendees** no longer lists the guest

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/documents/test/attendance/guests.test.ts`

## AC-6: Not open to guests, no form

IF an event is not open to guests, THEN Skjera SHALL refuse a guest sign-up and the page SHALL ask the visitor to log in instead.

**Test**

- **Given** the event without **Guests can sign up**
- **When** it is opened in a private window
- **Then** there is no form, only «Log in to attend»

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/documents/test/attendance/guests.test.ts`

## AC-7: A member's email address is refused

IF a guest signs up with an email address on a domain members log in with (ACC-03), THEN Skjera SHALL refuse the sign-up, on the server too, and tell them to log in. A subdomain of such a domain is not one.

**Test**

- **Given** the event open to guests, and `example.com` among the domains members log in with
- **When** a guest signs up in a private window with a name and `bob@example.com`
- **Then** the email field says «Log in to sign up for the event!» (in Bokmål and Nynorsk «Logg deg inn for å melde deg på arrangementet!»), and the page still says «Nobody has signed up yet.»

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/app/test/signupForm.test.ts`, `packages/documents/test/attendance/guests.test.ts`, `packages/documents/test/api/Problems.test.ts`

## AC-8: A name has at least two characters

IF a guest's name has fewer than two characters, THEN Skjera SHALL refuse the sign-up, in the form before it is sent and on the server, with a message by the name field.

**Test**

- **Given** the event open to guests
- **When** a guest signs up in a private window with the name «G» and a new email
- **Then** nothing is sent, the name field says «Enter your name, at least 2 characters», and the page still says «Nobody has signed up yet.»

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/documents/test/Model.test.ts`, `packages/documents/test/attendance/guests.test.ts`
