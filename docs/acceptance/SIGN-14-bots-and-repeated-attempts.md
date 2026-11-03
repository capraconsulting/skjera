# SIGN-14: Signing up and cancelling are protected against bots and repeated attempts

The guest forms have a hidden field that people never see and bots fill in, and signing up and cancelling can only be tried so many times. Both are as in Skjer.

The tests by hand use the events of SIGN-02, on a test server (`pnpm test-server`, see the Readme): the browser tests run with the limits off, so only a test server started by hand has them on.

## AC-1: A hidden field on the guest forms

The guest form for signing up, and a guest's **Cancel my signup**, SHALL have a hidden field that is not shown, read out or reached with the keyboard.

**Test**

- **Given** the event open to guests
- **When** it is opened in a private window, and you press Tab from «Your name» through the form to **Sign up**, with a screen reader on if you have one
- **Then** Tab goes from field to field without stopping at anything you can't see, nothing unseen is read out, and no field is shown for the hidden one
- **When** a guest signs up in that window, and you press Tab from **Change answers** to **Cancel my signup**
- **Then** Tab goes straight from one to the other, and nothing unseen is read out

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`

## AC-2: A form with the hidden field filled in is refused

IF a guest form is sent with the hidden field filled in, THEN Skjera SHALL refuse it, save nothing and send no email.

**Test**

- **Given** the event open to guests, opened in a private window
- **When** you open the browser's developer tools, give the hidden field (`<input name="subject" hidden>`) a value, fill in a name and a new email, and press **Sign up**
- **Then** the form says «Det har oppstått et problem. Det utfylte skjemaet er ikke gyldig.» (in the page's language), the box still says nobody has signed up, and Mailpit has no new email
- **When** a guest signs up for real, you give the hidden field of their **Cancel my signup** a value, and press it
- **Then** the same sentence shows, the box still says «You're signed up.», and Mailpit has no cancellation email

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/documents/test/attendance/guests.test.ts`

## AC-3: Guests have limits

IF guests sign up or cancel more than 20 times in an hour from the same IP address, or more than 10 times in a minute from the same IP address and browser, THEN Skjera SHALL refuse the attempt with «Du har nådd grensen for antall forsøk. Vennligst vent en stund før du prøver igjen.», and in Nynorsk and English with sentences of their own.

Signing up and cancelling count together, across events.

**Test**

- **Given** the event open to guests, opened in a private window, not logged in
- **When** you sign up and cancel in turn with new emails until an attempt is refused
- **Then** the 11th attempt within a minute is refused with the sentence, in the page's language, and after a minute the next attempt goes through

**Automated:** `packages/server/test/signupLimits.test.ts`, `packages/documents/test/api/Problems.test.ts`

## AC-4: Members have limits of their own

IF a member signs up or cancels more than 40 times in an hour from the same IP address, or more than 20 times in a minute from the same IP address and browser, THEN Skjera SHALL refuse the attempt with the same message.

A member's attempts are counted apart from guests'.

**Test**

- **Given** a member logged in, on an event open to members
- **When** they attend and cancel attendance in turn until an attempt is refused
- **Then** the 21st attempt within a minute is refused with the same sentence

**Automated:** `packages/server/test/signupLimits.test.ts`

## AC-5: A refused attempt does nothing

WHEN Skjera refuses an attempt over a limit, it SHALL save nothing and send no email.

**Test**

- **Given** an attempt refused as in AC-3
- **When** you look at the event's attendee list in the studio, and at Mailpit
- **Then** the refused attempt changed nothing in the list and sent no email

**Automated:** `packages/server/test/signupLimits.test.ts`

## AC-6: The visitor's address, not the proxy's

WHILE Skjera runs behind a proxy, the limits SHALL count the visitor's IP address, not the proxy's.

The visitor's address is the `X-Forwarded-For` entry as many places from the right as `PROXY_COUNT` says (1 by default: the ingress). Entries further left are the visitor's own writing, and are never read.

**Test**

- **Given** a test server at `https://`, behind `tailscale serve`, or the deployed site
- **When** one visitor on one network is refused by AC-3, and another visitor on another network, with the same browser, signs up as a guest
- **Then** the second visitor is not refused, because each address is counted on its own

**Automated:** `packages/server/test/signupLimits.test.ts`
