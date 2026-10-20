# SIGN-08: Dietary preferences, without a name

Dietary preferences are kept for the event, with no tie to who gave them, and the organiser sees them as a list.

**Events:** public events open to guests, with **Food is served**, what is served, and a food deadline that hasn't passed.

## AC-1: The field is offered, and optional

While an event serves food and its food deadline has not passed, the sign-up form shall offer an optional dietary preferences field, for members and guests alike.

**Test**

- **Given** an event serving food
- **When** bob, and a guest in a private window, open it
- **Then** both see «Dietary preferences (optional)», and signing up with it empty goes through

**Automated:** `packages/app/e2e/specs/attendance/dietary.spec.ts`, `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/documents/test/attendance/dietary.test.ts`

## AC-2: Kept without a name

When someone signs up with a non-empty dietary preference, the server shall store it for the event with no reference to the signup, the user or the guest who gave it.

**Test**

- **Given** an event serving food
- **When** bob signs up with a preference, and you open the event in the studio
- **Then** «Dietary preferences (1)» has the preference, without a name. That the database has no tie either is left to the tests.

**Automated:** `packages/app/e2e/specs/attendance/dietary.spec.ts`, `packages/documents/test/attendance/dietary.test.ts`

## AC-3: An empty field is accepted, and stores nothing

When someone signs up with the dietary preferences field empty, the server shall accept the signup and store no dietary preference.

**Test**

- **Given** an event serving food
- **When** bob signs up with the field empty
- **Then** he is signed up, and the count in «Dietary preferences (…)» doesn't grow

**Automated:** `packages/app/e2e/specs/attendance/dietary.spec.ts`, `packages/documents/test/attendance/dietary.test.ts`

## AC-4: The organiser sees the list and the count

The organiser's view of an event shall show the dietary preferences given for that event and how many there are, without any name.

**Test**

- **Given** an event serving food
- **When** bob and a guest each sign up with a preference, and you open or reload the event in the studio
- **Then** «Dietary preferences (2)» has both, without names. The list is read when the event is opened, not as signups come in.

**Automated:** `packages/app/e2e/specs/attendance/dietary.spec.ts`, `packages/documents/test/attendance/dietary.test.ts`

## AC-5: Not in the attendee list or the spreadsheet

The attendee list and the CSV export of attendees shall not contain dietary preferences.

**Test**

- **Given** bob signed up with a preference
- **When** you look at **Attendees** in the studio, and **Download CSV**
- **Then** neither has the preference; it is only in the list of its own

**Automated:** `packages/app/e2e/specs/attendance/questions.spec.ts`, `packages/documents/test/attendance/dietary.test.ts`

## AC-6: Changing or cancelling leaves them

When someone changes their answers or cancels their signup, the dietary preferences stored for the event shall stay as they are.

**Test**

- **Given** bob signed up with a preference
- **When** he cancels, and you reload the event in the studio
- **Then** the preference is still in the list

**Automated:** `packages/app/e2e/specs/attendance/dietary.spec.ts`, `packages/documents/test/attendance/dietary.test.ts`

## AC-7: Earlier preferences were moved

When the database is migrated, every dietary preference already stored on a signup shall be moved into its event's list, and signups shall no longer hold dietary preferences.

**Automated only:** it needs a database from before the change. `packages/documents/test/server/migrations.test.ts`
