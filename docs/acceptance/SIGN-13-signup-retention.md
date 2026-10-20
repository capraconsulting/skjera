# SIGN-13: Sign-up data deleted after 30 days

Sign-up data is deleted 30 days after an event has ended, as the privacy page promises.

The job runs at night, on events that ended more than 30 days before, so only the privacy page can be tested by hand.

## AC-1: A daily job

The server shall run a job every day at 01:00 UTC that deletes the sign-up data of every event that ended more than 30 days before.

**Automated only:** `packages/documents/test/attendance/SignupRetention.test.ts`

## AC-2: Every signup goes

When the job deletes an event's sign-up data, the server shall delete every signup of that event, both members and guests, with all the details and answers stored on it.

**Automated only:** `packages/documents/test/attendance/SignupRetention.test.ts`

## AC-3: The dietary list goes

When the job deletes an event's sign-up data, the server shall delete that event's list of dietary preferences.

**Automated only:** `packages/documents/test/attendance/SignupRetention.test.ts`

## AC-4: Deleted events too

When an event has been deleted, the job shall delete its sign-up data 30 days after it ended, as for any other event.

**Automated only:** `packages/documents/test/attendance/SignupRetention.test.ts`

## AC-5: Nothing before 30 days

The job shall not delete sign-up data of an event that ended 30 days ago or less, nor of an event that has not ended.

**Automated only:** `packages/documents/test/attendance/SignupRetention.test.ts`

## AC-6: The event stays

The job shall not delete the event itself, its content or its editing history.

**Automated only:** `packages/documents/test/attendance/SignupRetention.test.ts`

## AC-7: The privacy page says so

The privacy page shall say, in Norwegian Bokmål, Nynorsk and English, that sign-up data is deleted 30 days after the event has ended.

**Test**

- **Given** the site
- **When** you open http://localhost:5173/privacy, and pick each language in the header
- **Then** «How long» says, in each language, that sign-up data is deleted 30 days after the event has ended

**Automated:** `packages/app/e2e/specs/site.spec.ts`
