# SIGN-03: Phone and company for guests

Guests can give a phone number and a company when they sign up. Members aren't asked.

**Events:** one public event open to guests.

## AC-1: The guest form offers both, optional

The sign-up form for guests SHALL offer a phone number and a company, both optional.

**Test**

- **Given** the event
- **When** a guest opens it in a private window
- **Then** the form has «Your phone number (optional)» and «Your company (optional)», and signing up with both empty goes through

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/documents/test/Model.test.ts`, `packages/documents/test/attendance/guests.test.ts`

## AC-2: They are kept with the sign-up

WHEN a guest signs up with a phone number or a company, Skjera SHALL keep them with the sign-up.

**Test**

- **Given** the event
- **When** a guest signs up with both filled in
- **Then** the studio's **Attendees** lists the guest with both

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/documents/test/attendance/guests.test.ts`

## AC-3: The guest can change them until sign-up closes

Skjera SHALL let a guest change their phone number and company until sign-up closes, as they can change their other answers.

**Test**

- **Given** a guest signed up with a phone number and a company
- **When** the guest changes both with **Change answers** and **Save changes**
- **Then** the studio's **Attendees** shows the new ones

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/app/e2e/specs/attendance/limit.spec.ts`, `packages/documents/test/attendance/guests.test.ts`

## AC-4: Attendees and the spreadsheet show them

The studio's list of attendees and the exported spreadsheet SHALL show each guest's phone number and company.

**Test**

- **Given** a guest signed up with a phone number and a company
- **When** you click **Download CSV** in the studio
- **Then** the guest's phone number and company are in it

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/app/e2e/specs/attendance/limit.spec.ts`

## AC-5: Members aren't asked

Skjera SHALL NOT ask members signing up with their login for a phone number or a company.

**Test**

- **Given** the event
- **When** bob opens it
- **Then** there are no fields for phone or company

**Automated:** `packages/app/e2e/specs/attendance/questions.spec.ts`, `packages/documents/test/attendance/guests.test.ts`
