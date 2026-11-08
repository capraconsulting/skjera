# SIGN-15: Invitations in the studio

Each event in the studio has a section «Invitations» beside the attendee list, where an organiser notes who has been invited, by name and email. It is only a record: nobody is emailed, and nobody is signed up by it. The attendee list is SIGN-11, and when the list is deleted is SIGN-13.

**Events:** one public event open to guests.

## AC-1: A section for each event

The studio SHALL show a section «Invitations» for each event, published or not, with the help text saying it only records who was invited and sends nothing.

**Test**

- **Given** the event open in the studio, and a new event that has not been published
- **When** you look under the attendee list of each
- **Then** each has «Invitations», with a help text saying it is only a GDPR-friendly record of who was invited (not signed up), and that adding someone sends no invitation or information

**Automated:** `packages/app/e2e/specs/attendance/invitations.spec.ts`, `packages/documents/test/attendance/invitations.test.ts`

## AC-2: Adding someone

WHEN an organiser adds a valid email address, with or without a name, the studio SHALL add the person to the event's list, say «gina@example.org was added to the list» and empty the fields.

**Test**

- **Given** the event open in the studio
- **When** you type «Gina Guest» as the full name and «gina@example.org» as the email, and click **Add**
- **Then** «gina@example.org was added to the list» is shown, both fields are empty, and the list has «Gina Guest - gina@example.org»
- **When** you type only «hana@example.org», and click **Add**
- **Then** the list also has «hana@example.org»

**Automated:** `packages/app/e2e/specs/attendance/invitations.spec.ts`, `packages/documents/test/attendance/invitations.test.ts`

## AC-3: An address that isn't valid

IF the email address is missing or not valid, THEN the studio SHALL refuse it with a message next to the field.

**Test**

- **Given** the event open in the studio
- **When** you click **Add** with the email empty, and then with «gina@example»
- **Then** «Enter a valid email address» is shown under the email field each time, and nobody is added

**Automated:** `packages/app/e2e/specs/attendance/invitations.spec.ts`, `packages/documents/test/attendance/invitations.test.ts`, `packages/documents/test/Model.test.ts`, `packages/documents/test/api/Problems.test.ts`

## AC-4: An address already on the list

IF the email address is already on the event's list, THEN the studio SHALL refuse it with «gina@example.org has already been added».

**Test**

- **Given** «gina@example.org» on the event's list
- **When** you add «Gina@Example.org»
- **Then** «Gina@Example.org has already been added» is shown under the email field, and the list is as it was
- **When** you add «gina@example.org» to another event
- **Then** it is added there

**Automated:** `packages/app/e2e/specs/attendance/invitations.spec.ts`, `packages/documents/test/attendance/invitations.test.ts`, `packages/documents/test/api/Problems.test.ts`

## AC-5: The list

The section SHALL list those invited as «Name - email», or the email alone, under «Invitations (N)», or say «No invitations» when there are none. Only signed-in users can read the list.

**Test**

- **Given** an event with nobody invited
- **When** you open it in the studio
- **Then** the section says «No invitations»
- **When** you add «Gina Guest» with «gina@example.org», and «hana@example.org» without a name, and reload
- **Then** the heading is «Invitations (2)», and the list reads «Gina Guest - gina@example.org» and «hana@example.org», in the order they were added
- **When** you open `http://localhost:5173/api/events/<the event's id>/invitations` in a private window
- **Then** you get a refusal, not the list

**Automated:** `packages/app/e2e/specs/attendance/invitations.spec.ts`, `packages/app/test/studio/invitations.test.ts`, `packages/documents/test/attendance/invitations.test.ts`

## AC-6: Nothing is sent

WHEN a person is added to the list, Skjera SHALL NOT send any email.

**Test**

- **Given** Mailpit at http://localhost:8025 empty
- **When** you add «gina@example.org» to the list
- **Then** Mailpit has no email

**Automated only:** `packages/documents/test/attendance/invitations.test.ts`

## AC-7: Deleted with the signups

WHEN an event's signups are deleted 30 days after it ends, Skjera SHALL delete its invitations too. For an event never published, that is 30 days after its draft's end.

**Automated only:** `packages/documents/test/attendance/SignupRetention.test.ts`, which SIGN-13 describes.
