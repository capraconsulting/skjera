# SIGN-11: Attendee list in the studio

The studio lists who has signed up for an event, with their answers, lets an organiser search the list, and lets an organiser take someone off. A guest's phone and company are in SIGN-03, in person or online in SIGN-07, and dietary preferences, kept apart from the list, in SIGN-08. What the site shows of who's coming is in SITE-06.

**Events:** one public event open to guests, with the questions «Towel size», **One of several** with the options «Small» and «Large», and «I bring a friend», a **Checkbox**; and «AC-8: Ended», a public event open to guests, starting in a few minutes and ending a few minutes later, with one guest signed up before it starts.

## AC-1: Everyone signed up, with a count

The studio SHALL list everyone signed up for an event, with their name and email, guests marked as such, and the count in the heading.

**Test**

- **Given** bob signed up, and a guest signed up in a private window
- **When** you open the event in the studio
- **Then** «Attendees (2)» lists bob with `bob@example.com`, and the guest with their email and **Guest**

**Automated:** `packages/app/e2e/specs/attendance/members.spec.ts`, `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/documents/test/attendance/guests.test.ts`

## AC-2: Each with their answers

The studio SHALL show each attendee's answers under the questions, with a ticked box as «Yes» and an unticked one as «No».

**Test**

- **Given** bob signed up with «Large» and the box ticked, and a guest with «Small» and the box unticked
- **When** you open the event in the studio
- **Then** bob has «Towel size» «Large» and «I bring a friend» «Yes», and the guest «Small» and «No»

**Automated:** `packages/app/e2e/specs/attendance/questions.spec.ts`, `packages/documents/test/attendance/signups.test.ts`

## AC-3: Answers keep the question as it was asked

WHEN an organiser rewords a question after people have answered it, the studio SHALL show their answers under the wording they answered.

**Test**

- **Given** bob signed up with «Large»
- **When** you change «Towel size» to «Size of towel» and **Publish**
- **Then** bob's answer is still under «Towel size»
- **When** bob clicks **Change answers** and **Save changes**
- **Then** it is under «Size of towel»

**Automated:** none

## AC-4: The list follows sign-ups live

WHEN someone signs up or cancels, the studio's list SHALL show it without being reloaded.

**Test**

- **Given** the event open in the studio
- **When** bob signs up, and then cancels
- **Then** alice's list gains bob and loses him again, with no reload

**Automated:** `packages/app/e2e/specs/attendance/whos-coming.spec.ts`, `packages/app/e2e/specs/attendance/members.spec.ts`

## AC-5: The organiser takes someone off

WHEN an organiser removes an attendee and confirms, Skjera SHALL take them off the event.

**Test**

- **Given** a guest signed up in a private window
- **When** you click **Remove** on the guest's row in the studio, and say OK to «Take Gina off this event?» (with the guest's name)
- **Then** the guest is gone from the list, and the guest's page, reloaded, shows the form again

**Automated:** `packages/app/e2e/specs/attendance/questions.spec.ts`, `packages/app/e2e/specs/attendance/dietary.spec.ts`, `packages/documents/test/attendance/signups.test.ts`

## AC-6: Also after sign-up closes

WHILE sign-up has closed, Skjera SHALL still let an organiser take attendees off.

**Test**

- **Given** bob signed up
- **When** you set **Sign-up deadline** to a time that has passed, **Publish**, and remove bob
- **Then** he is gone from the list

**Automated:** `packages/documents/test/attendance/signups.test.ts`

## AC-7: The person taken off is told

WHEN an organiser takes someone off an event that has not ended, Skjera SHALL email them that the organiser took them off, with a cancellation that takes the event out of their calendar. The email is MAIL-02's.

**Test**

- **Given** a guest signed up in a private window
- **When** you click **Remove** on the guest's row in the studio, and say OK
- **Then** the guest gets «Signup cancelled: …» in Mailpit, saying that the organisers took them off the event, and its attached cancellation (`.ics`) has `METHOD:CANCEL`

**Automated:** `packages/documents/test/attendance/signups.test.ts`, `packages/documents/test/notices/signups.test.tsx`

## AC-8: Not when the event has ended

IF an organiser takes someone off an event that has ended, THEN Skjera SHALL not email them.

**Test**

- **Given** «AC-8: Ended», after it has ended, open in the studio
- **When** you click **Remove** on the guest's row, and say OK
- **Then** the guest is gone from the list, and has no «Signup cancelled: …» in Mailpit

**Automated:** `packages/documents/test/attendance/signups.test.ts`

## AC-9: Searching the list

WHILE anyone is signed up for an event, the studio SHALL show a «Search» field above the attendee list that narrows the list to those whose name, email, phone or company contains the text, ignoring case. An empty field shows everyone.

**Test**

- **Given** bob signed up, and a guest who gave the phone number «911 11 111» and the company «Initech»
- **When** you open the event in the studio
- **Then** a «Search» field is above the list
- **When** you type «initech» in it
- **Then** the guest's row is shown and bob's is not

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/app/test/attendeeSearch.test.ts`

## AC-10: The count and the CSV cover everyone

WHILE a search narrows the attendee list, the studio SHALL still count everyone signed up in the heading, and **Download CSV** SHALL still cover everyone signed up.

**Test**

- **Given** the list narrowed to the guest by a search
- **When** you read the heading and click **Download CSV**
- **Then** the heading says «Attendees (2)», and the file has both the guest's and bob's rows

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`

## AC-11: No search while nobody is signed up

WHILE nobody is signed up for an event, the studio SHALL NOT show the search field.

**Test**

- **Given** a published event nobody has signed up for
- **When** you open it in the studio
- **Then** the list says «Nobody has signed up yet.» and has no «Search» field

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`
