# SIGN-16: A guest cancels by typing their email on the event page

A guest who has lost the email with their own link can still cancel: the event page has a form for their email address, Skjera emails them a link that is valid for 2 hours, and the link's page cancels only when its button is pressed. Programs that check links in email open them too, so opening a link never cancels.

The tests by hand use the event of SIGN-04, on a test server with Mailpit (`pnpm test-server`, see the Readme). Sign up as a guest in one private window, and use another private window for the form, so the second window holds no signup of its own.

## AC-1: The form is on the page while sign-up is open

WHILE an event is open for sign-up, its page SHALL show «Ønsker du å melde deg av?» under the sign-up box, with a field «Skriv inn din e-post her» and the button «Meld meg av», in the page's language. This holds for someone not logged in whose browser holds no signup of its own, and for a full event too.

**Test**

- **Given** the event, with a guest signed up in another window
- **When** it is opened in a new private window, and in English
- **Then** under the box «Attendance» is the region «Want to cancel your signup?» with a field «Enter your email here» and the button **Cancel my signup**
- **When** the event's maximum number of attendees is set to the number signed up, and the page is opened again
- **Then** the box says «There are no more places.», and the region is still there

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/app/e2e/specs/attendance/limit.spec.ts`

## AC-2: Not after the deadline

WHILE the sign-up deadline has passed, the event page SHALL NOT show the form, and asking for a link SHALL be refused.

**Test**

- **Given** the event, with a **Sign-up deadline** that has passed
- **When** it is opened in a private window
- **Then** the box says «Sign-up has closed.», and there is no region «Want to cancel your signup?»

**Automated:** `packages/app/e2e/specs/site.spec.ts`, `packages/documents/test/attendance/signups.test.ts`

## AC-3: An email with a link is sent, and the page says so

WHEN a guest submits an address signed up for the event, Skjera SHALL send an email with the subject «Bekreft avregistrering: {title}» and a link valid for 2 hours, and say «En e-post har blitt sendt til {email} med en lenke for å bekrefte avmeldingen.».

The address is found without regard to case or spaces around it, and only guests' signups are found. The email is in the language the guest signed up in, and asking again sends another email.

**Test**

- **Given** a guest signed up as Gina, with her address in Mailpit
- **When** you type her address in the form and press **Meld meg av**
- **Then** the region says an email has been sent to the address, and Mailpit has the email «Bekreft avregistrering: …» (in the language she signed up in) with a button **Bekreft avmelding**
- **When** you type her address in capital letters with a space after it, and press the button again
- **Then** a second email arrives

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/documents/test/attendance/guestCancellation.test.ts`, `packages/documents/test/notices/signups.test.tsx`

## AC-4: An address nobody signed up with

IF the submitted address isn't signed up for the event, THEN Skjera SHALL say «Vi finner dessverre ingen opplysninger om påmelding med denne e-posten.», and send nothing.

This goes for an address signed up for another event, and for a member's address: members log in to cancel.

**Test**

- **Given** the event
- **When** you type an address nobody signed up with, and press **Meld meg av**
- **Then** the region says the sentence, and Mailpit has no new email

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/documents/test/attendance/guestCancellation.test.ts`, `packages/documents/test/api/Problems.test.ts`

## AC-5: Opening the link cancels nothing

WHEN the guest opens the link, Skjera SHALL show the event's title and a button «Bekreft avmelding», and SHALL NOT cancel yet.

**Test**

- **Given** the email from AC-3
- **When** its button is opened in a new private window
- **Then** the page shows the event's title and **Bekreft avmelding**, and the studio's **Attendees** still lists Gina

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/documents/test/attendance/guestCancellation.test.ts`

## AC-6: Pressing the button cancels

WHEN the guest presses «Bekreft avmelding», Skjera SHALL cancel the signup, say «Du er nå meldt av arrangementet 👋 Vi har sendt deg en bekreftelse på e-post.» and send the cancellation email of MAIL-02. WHERE the site sends no email, it says «Du er nå meldt av arrangementet 👋 Vi kunne dessverre ikke sende en e-post bekreftelse.» instead.

A link opened or confirmed after the sign-up deadline cancels nothing, and says that sign-up has closed.

**Test**

- **Given** the page from AC-5
- **When** you press **Bekreft avmelding**
- **Then** the page says the sentence, the studio's **Attendees** no longer lists Gina, and Mailpit has the email «Signup cancelled: …»

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/documents/test/attendance/guestCancellation.test.ts`, `packages/documents/test/attendance/signups.test.ts`

## AC-7: A link that does not work says so

IF the link has expired, has been used or is not valid, THEN Skjera SHALL say so, with a link to the event. Each of the three has a sentence of its own.

**Test**

- **Given** the link from AC-5, used
- **When** you open it again
- **Then** the page says «Du er allerede meldt av arrangementet. Takk for interessen din!» (in the page's language), with the link **Gå til arrangementet**, which leads to the event. The server cannot tell a signup cancelled with the link from one the organisers took off, so both say it
- **When** you change a letter in the link's `token`, and open it
- **Then** the page says «Lenken er ikke gyldig.», with the same link
- **When** you wait 2 hours, and open a link from an earlier email
- **Then** the page says «Lenken er utløpt. Du kan be om en ny på siden til arrangementet.»

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/documents/test/attendance/guestCancellation.test.ts`

## AC-8: Protected as the sign-up form is

The form SHALL be protected against bots and repeated attempts as the sign-up form is: it has a hidden field, and asking for a link and confirming count with signing up and cancelling (SIGN-14).

**Test**

- **Given** the event, opened in a private window
- **When** you give the form's hidden field (`<input name="subject" hidden>`) a value, type an address, and press **Meld meg av**
- **Then** the region says «Det har oppstått et problem. Det utfylte skjemaet er ikke gyldig.», and Mailpit has no new email
- **When** you ask for links with new addresses, on a test server with the limits on, until an attempt is refused
- **Then** the 11th attempt within a minute is refused with «Du har nådd grensen for antall forsøk. Vennligst vent en stund før du prøver igjen.»

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/documents/test/attendance/guestCancellation.test.ts`

## AC-9: The form is not read as a contact by HubSpot

The cancel form's email field SHALL be named `cancelEmail`, not `email`, so that HubSpot's collected forms do not record a cancel as a contact.

**Test**

- **Given** a test server with `HUBSPOT_ACCOUNT_ID` set
- **When** you cancel by email
- **Then** HubSpot has no new contact from it

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`
