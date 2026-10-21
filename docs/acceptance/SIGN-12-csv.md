# SIGN-12: Downloading attendees as CSV

The organiser downloads the attendee list as a spreadsheet. The phone and company columns are in SIGN-03 AC-4, the attending column of a streamed event in SIGN-07, and that the spreadsheet has no dietary preferences in SIGN-08 AC-5.

**Events:** one public event open to guests, with the question «Towel size», **One of several** with the options «Small» and «Large», and a **Written answer** «Where did you hear of it?». Bob and one guest signed up.

## AC-1: A file named after the event

WHILE anyone is signed up for an event, the studio SHALL offer **Download CSV**, which downloads the attendees as a file named after the event.

**Test**

- **Given** the event, before anyone signs up
- **Then** **Attendees** has no **Download CSV**
- **When** bob signs up, and you click **Download CSV**
- **Then** the file is named after the event's title, followed by « attendees.csv» (the browser may swap the title's colon for another character)

**Automated:** `packages/app/e2e/specs/attendance/questions.spec.ts`

## AC-2: The columns

The spreadsheet SHALL have the columns Name, Email, Guest, Signed up, Changed, Phone and Company, then one for each question, named by its wording.

**Test**

- **Given** the event with bob and a guest signed up
- **When** you click **Download CSV**
- **Then** the first line is «Name,Email,Guest,Signed up,Changed,Phone,Company,Towel size,Where did you hear of it?»

**Automated:** `packages/app/e2e/specs/attendance/questions.spec.ts`, `packages/app/e2e/specs/attendance/guests.spec.ts`

## AC-3: A row per person, with their answers as they are now

The spreadsheet SHALL have one row for each person signed up, with «Yes» or «No» under Guest and their current answers.

**Test**

- **Given** the event with bob and a guest signed up, and the guest's answer changed with **Change answers** afterwards
- **When** you click **Download CSV**
- **Then** there is one row for bob with «No» and one for the guest with «Yes», each with their answers, the guest's as changed

**Automated:** `packages/app/e2e/specs/attendance/questions.spec.ts`

## AC-4: When they signed up and last changed

The spreadsheet SHALL give, for each person, when they signed up and when they last changed their answers.

**Test**

- **Given** bob signed up, and a few minutes later changed his answer with **Change answers**
- **When** you click **Download CSV**
- **Then** his Signed up and Changed are those two times, as UTC (such as «2026-10-20T08:15:00.000Z»), and a guest who changed nothing has the same time in both

**Automated:** `packages/app/test/attendeesCsv.test.ts`, `packages/documents/test/attendance/signups.test.ts`

## AC-5: Questions taken off still have their column

WHERE a question has been taken off the event after people answered it, the spreadsheet SHALL still have its column, after the others, with the answers given.

**Test**

- **Given** bob signed up with an answer to «Where did you hear of it?»
- **When** you remove that question in the studio, **Publish**, and click **Download CSV**
- **Then** «Where did you hear of it?» is the last column, with bob's answer

**Automated:** `packages/app/test/attendeesCsv.test.ts`

## AC-6: Answers can't run as formulas

IF an answer starts like a spreadsheet formula, THEN the spreadsheet SHALL keep it as text, so a spreadsheet program does not run it.

**Test**

- **Given** the event
- **When** a guest signs up with «=1+1» for «Where did you hear of it?», and you click **Download CSV**
- **Then** the file has «'=1+1», and a spreadsheet program opening it shows the text, not 2

**Automated:** `packages/app/test/attendeesCsv.test.ts`
