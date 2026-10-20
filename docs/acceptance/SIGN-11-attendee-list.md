# SIGN-11: Attendee list in the studio

The studio lists who has signed up for an event, with their answers, and lets an organiser take someone off. A guest's phone and company are in SIGN-03, in person or online in SIGN-07, and dietary preferences, kept apart from the list, in SIGN-08. What the site shows of who's coming is in SITE-06.

**Events:** one public event open to guests, with the questions «Towel size», **One of several** with the options «Small» and «Large», and «I bring a friend», a **Checkbox**.

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
