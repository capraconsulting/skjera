# SIGN-12: Downloading attendees as an Excel file

The organiser downloads the attendee list as an Excel file, as in Skjer. The phone and company columns are in SIGN-03 AC-4, the online column of a streamed event in SIGN-07 AC-5, and that the file has no dietary preferences in SIGN-08 AC-5.

**Events:** one public event open to guests, with the question «Towel size», **One of several** with the options «Small» and «Large», and a **Written answer** «Where did you hear of it?». Bob and one guest signed up.

## AC-1: A file named after the event

WHILE anyone is signed up for an event, the studio SHALL offer **Download Excel**, which downloads the attendees as an Excel file named after the event, `{title}.xlsx`.

**Test**

- **Given** the event, before anyone signs up
- **Then** **Attendees** has no **Download Excel**
- **When** bob signs up, and you click **Download Excel**
- **Then** the file is named after the event's title, followed by «.xlsx» (the browser may swap the title's colon for another character)

**Automated:** `packages/app/e2e/specs/attendance/questions.spec.ts`, `packages/app/test/attendeesSheet.test.ts`

## AC-2: The sheet and the columns

The file SHALL have one sheet, «Påmeldinger» (in the page's language: «Sign-ups» in English), with the columns Navn and Epost, then Telefon and Selskap WHERE guests can sign up, then Digitalt WHERE the event is streamed, then one for each question, named by the words its answers were given to. In English the headings are Name, Email, Phone, Company and Online.

**Test**

- **Given** the event with bob and a guest signed up
- **When** you click **Download Excel**, and open the file
- **Then** the sheet is called «Sign-ups» and its first row is «Name, Email, Phone, Company, Towel size, Where did you hear of it?»
- **And** for an event not open to guests, and not streamed, the first row is «Name, Email» and the questions

**Automated:** `packages/app/e2e/specs/attendance/questions.spec.ts`, `packages/app/test/attendeesSheet.test.ts`

## AC-3: A row per person, with their answers as they are now

The file SHALL have one row for each person signed up, with their current answers, and «Yes» or «No» under Online WHERE the event is streamed.

**Test**

- **Given** the event with bob and a guest signed up, and the guest's answer changed with **Change answers** afterwards
- **When** you click **Download Excel**
- **Then** there is one row for bob and one for the guest, each with their answers, the guest's as changed

**Automated:** `packages/app/e2e/specs/attendance/questions.spec.ts`, `packages/app/test/attendeesSheet.test.ts`

## AC-4: Questions taken off still have their column

WHERE a question has been taken off the event after people answered it, the file SHALL still have its column, after the others, with the answers given.

**Test**

- **Given** bob signed up with an answer to «Where did you hear of it?»
- **When** you remove that question in the studio, **Publish**, and click **Download Excel**
- **Then** «Where did you hear of it?» is the last column, with bob's answer

**Automated:** `packages/app/test/attendeesSheet.test.ts`

## AC-5: Answers can't run as formulas

IF an answer starts like a spreadsheet formula, THEN the file SHALL keep it as text, so a spreadsheet program does not run it.

**Test**

- **Given** the event
- **When** a guest signs up with «=1+1» for «Where did you hear of it?», and you click **Download Excel**
- **Then** the cell has the text «=1+1», and a spreadsheet program shows the text, not 2

**Automated:** `packages/app/test/attendeesSheet.test.ts`

## AC-6: Answers to earlier words have a column of their own

WHERE a question's words were changed after people answered it, the file SHALL give the answers to the earlier words a column of their own, headed with those words, after the other columns.

**Test**

- **Given** bob signed up with an answer to «Towel size»
- **When** you change that question to «Towel size?» in the studio, **Publish**, and gina signs up with an answer to it, and you click **Download Excel**
- **Then** the columns end «Towel size?», «Towel size»; gina's answer is under «Towel size?» and bob's under «Towel size»

**Automated:** `packages/app/test/attendeesSheet.test.ts`
