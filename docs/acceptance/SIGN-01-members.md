# SIGN-01: Members sign up and cancel

Members logged in sign up for an event with one click, and cancel the same way.

**Events:** one event, not open to guests.

## AC-1: A member signs up

WHILE a member is logged in and sign-up is open, the event page SHALL offer **Attend**, and clicking it SHALL sign the member up.

**Test**

- **Given** the event, with nobody signed up
- **When** bob opens it and clicks **Attend**
- **Then** the page says «You're attending.» and «1 attending», and the studio's **Attendees** lists bob with his email

**Automated:** `packages/app/e2e/specs/attendance/members.spec.ts`, `packages/documents/test/attendance/signups.test.ts`

## AC-2: A member cancels

WHILE a member is signed up and sign-up is open, the event page SHALL offer **Cancel attendance**, and clicking it SHALL take the member off.

**Test**

- **Given** bob signed up for the event
- **When** he clicks **Cancel attendance**
- **Then** the page says «Nobody has signed up yet.», **Attend** is back, and the studio's **Attendees** no longer lists him

**Automated:** `packages/app/e2e/specs/attendance/members.spec.ts`, `packages/app/e2e/specs/attendance/whos-coming.spec.ts`, `packages/documents/test/attendance/signups.test.ts`

## AC-3: Signing up twice counts once

IF a member signs up for an event they are already signed up for, THEN Skjera SHALL keep one sign-up and send one confirmation email.

**Automated only:** the page offers no second **Attend** once signed up. `packages/documents/test/attendance/signups.test.ts`, `packages/documents/test/notices/signups.test.tsx`

## AC-4: Not logged in, asked to log in

WHERE an event is not open to guests, the event page SHALL ask a visitor who is not logged in to log in to attend.

**Test**

- **Given** the event
- **When** it is opened in a private window
- **Then** the sign-up box has the link «Log in to attend», and no form

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/documents/test/attendance/guests.test.ts`
