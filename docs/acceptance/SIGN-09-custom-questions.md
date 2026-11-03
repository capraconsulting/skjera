# SIGN-09: Custom questions on the sign-up form

An event can ask its own questions of everyone signing up: a written answer, a checkbox, or one of several. How the organiser writes them is in STU-14; this is answering them.

**Events:** one public event open to guests, with three questions, added with **Add question** in the studio:

- «Where did you hear of it?», a **Written answer**
- «I accept the risks of swimming», a **Checkbox**, with **Must be ticked**
- «Towel size», **One of several**, with the options «Small» and «Large», and **Required**

## AC-1: The form asks the event's questions

WHILE sign-up is open, the sign-up form SHALL ask the event's questions in their order, each as its kind of field, with those not required marked as optional.

**Test**

- **Given** the event
- **When** it is opened in a private window
- **Then** the form has «Where did you hear of it? (optional)» with a text field, a box to tick, «I accept the risks of swimming», and «Towel size» with a choice of «Small» or «Large», «Small» chosen

**Automated:** `packages/app/e2e/specs/attendance/questions.spec.ts`, `packages/app/test/signupForm.test.ts`, `packages/documents/test/attendance/signups.test.ts`

## AC-2: Members and guests answer the same questions

Skjera SHALL ask members and guests the same questions.

**Test**

- **Given** the event
- **When** bob opens it, and a guest opens it in a private window
- **Then** both forms have the same three questions

**Automated:** `packages/app/e2e/specs/attendance/questions.spec.ts`

## AC-3: A required question must be answered

IF a required question is not answered, or a box that must be ticked is not ticked, THEN Skjera SHALL refuse the sign-up.

The browser stops the form before it is sent, and a choice always has an option chosen in the form, so the server's own messages, such as «Answer “Towel size”», are left to the tests.

**Test**

- **Given** the event
- **When** a guest fills in a name and an email, leaves the box unticked, and clicks **Sign up**
- **Then** the form isn't sent, and the browser points to the box

**Automated:** `packages/app/e2e/specs/attendance/questions.spec.ts`, `packages/documents/test/attendance/signups.test.ts`

## AC-4: A written answer has a limit

IF a written answer is longer than 1000 characters, THEN Skjera SHALL refuse the sign-up.

**Test**

- **Given** the event
- **When** a guest pastes a text of more than 1000 characters into «Where did you hear of it?»
- **Then** the field keeps the first 1000

**Automated:** `packages/documents/test/attendance/signups.test.ts`

## AC-5: Only the options offered

IF an answer to a question of one of several is not one of its options, THEN Skjera SHALL refuse the sign-up.

**Automated only:** the form offers only the options. `packages/documents/test/attendance/signups.test.ts`

## AC-6: The answers are kept as given

WHEN someone signs up, Skjera SHALL keep their answers with the sign-up: the text as written, the option picked, and a box as ticked or not.

**Test**

- **Given** the event
- **When** a guest signs up with «A poster», «Large», and the box ticked
- **Then** the studio's **Attendees** shows the guest with «A poster», «Large», and «Yes» for «I accept the risks of swimming»

**Automated:** `packages/app/e2e/specs/attendance/questions.spec.ts`, `packages/documents/test/attendance/signups.test.ts`
