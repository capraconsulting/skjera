# SIGN-05: Sign-up deadline

Signing up, changing answers and cancelling close at the sign-up deadline, or when the event starts if it has none. An event serving food can stop asking for dietary preferences earlier, at its food deadline.

**Events:** public events open to guests, one per criterion below. Unless the criterion says otherwise, the event is next week with no **Sign-up deadline**.

## AC-1: The page says when sign-up closes

WHILE sign-up is open, the event page SHALL say when it closes: at the sign-up deadline if there is one, otherwise when the event starts, in the event's time zone.

**Test**

- **Given** the event, starting at 18:00
- **When** it is opened in a private window
- **Then** it says «Sign-up closes …» with the start's date and «6:00 PM»
- **When** you set **Sign-up deadline** to the day before at 12:00 in the studio, **Publish**, and reload
- **Then** it says «Sign-up closes …» with that day and «12:00 PM»

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-2: Closed, with no buttons

WHILE sign-up has closed, the event page SHALL say so and offer no way to sign up, change answers or cancel, while still telling those signed up that they are.

**Test**

- **Given** the event with a question, bob signed up, and a guest signed up in a private window
- **When** you set **Sign-up deadline** to a time that has passed in the studio and **Publish**
- **And** the page is reloaded as bob, as the guest, and in a new private window
- **Then** all three say «Sign-up has closed.» with no buttons and no form; bob's also says «You're attending.», and the guest's «You're signed up.»

**Automated:** `packages/app/e2e/specs/site.spec.ts`, `packages/documents/test/attendance/signups.test.ts`

## AC-3: The server refuses late changes

IF a sign-up, a change of answers or a cancelling reaches the server after sign-up has closed, THEN Skjera SHALL refuse it with «Sign-up for this event has closed».

**Automated only:** the page closes the form itself at the deadline, so a late request can't be sent by hand. `packages/documents/test/attendance/signups.test.ts`

## AC-4: The deadline can't be after the start

IF an organiser sets a sign-up deadline after the event starts, THEN Skjera SHALL refuse to publish it.

**Test**

- **Given** the event open in the studio
- **When** you set **Sign-up deadline** to after the start, and click **Publish**
- **Then** it isn't published, with «The sign-up deadline can't be after the event starts»

**Automated:** `packages/documents/test/events/publishing.test.ts`

## AC-5: The food deadline is shown

WHILE an event serves food and its food deadline has not passed, the event page SHALL say by when dietary preferences are taken.

**Test**

- **Given** the event with **Food is served**, and a food deadline before sign-up closes
- **When** it is opened in a private window
- **Then** after «Sign-up closes …» it says «Dietary preferences by …» with the food deadline

**Automated:** none

## AC-6: After the food deadline, no dietary preferences

WHEN an event's food deadline has passed while sign-up is still open, Skjera SHALL still sign people up, without asking for or keeping dietary preferences.

**Test**

- **Given** the event with **Food is served**, and a food deadline that has passed
- **When** bob opens it
- **Then** there is no «Dietary preferences (optional)» field and no «Dietary preferences by …», and **Attend** signs him up
- **And** «Dietary preferences (…)» in the studio doesn't grow

**Automated:** `packages/documents/test/attendance/dietary.test.ts`

## AC-7: The food deadline can't be after sign-up closes

IF an organiser sets a food deadline after sign-up closes, THEN Skjera SHALL refuse to publish it.

**Test**

- **Given** the event with **Food is served** and a **Sign-up deadline**, open in the studio
- **When** you set the food deadline, under **What's served**, to after the sign-up deadline, and click **Publish**
- **Then** it isn't published, with «The food deadline can't be after sign-up closes»

**Automated:** `packages/documents/test/events/publishing.test.ts`
