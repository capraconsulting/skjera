# SIGN-10: Changing answers after signing up

Members and guests can change their answers until sign-up closes. A guest's phone number and company are in SIGN-03 AC-3, and in person or online in SIGN-07.

**Events:** public events open to guests, one per criterion below, each with the question «Towel size», **One of several**, with the options «Small» and «Large». For AC-4, also «Where did you hear of it?», a **Written answer** with **Required**.

## AC-1: The form starts from what was given

WHILE someone is signed up and sign-up is open, the event page SHALL offer **Change answers**, which opens their answers as they gave them.

**Test**

- **Given** bob signed up with «Small», and a guest signed up in a private window with «Large»
- **When** each clicks **Change answers**
- **Then** each sees «Your answers» with **Save changes** and **Keep as is**, bob's with «Small» picked and the guest's with «Large»

**Automated:** `packages/app/e2e/specs/attendance/questions.spec.ts`

## AC-2: Saved answers replace the old ones

WHEN someone saves changed answers, Skjera SHALL keep the new answers in place of the old.

**Test**

- **Given** bob signed up with «Small», and a guest signed up in a private window with «Large»
- **When** bob picks «Large», the guest picks «Small», and both click **Save changes**
- **Then** bob's page says «You're attending.» and the guest's «You're signed up.», and the studio's **Attendees** shows bob with «Large» and the guest with «Small»

**Automated:** `packages/app/e2e/specs/attendance/questions.spec.ts`, `packages/documents/test/attendance/signups.test.ts`

## AC-3: Keep as is changes nothing

WHEN someone closes the form with **Keep as is**, Skjera SHALL keep their answers as they were.

**Test**

- **Given** bob signed up with «Small»
- **When** he clicks **Change answers**, picks «Large», and clicks **Keep as is**
- **Then** the form closes, and the studio's **Attendees** still shows «Small»; **Change answers** opens with «Small» again

**Automated:** `packages/app/e2e/specs/attendance/questions.spec.ts`

## AC-4: Changes are checked like a sign-up

IF changed answers leave a required question unanswered, THEN Skjera SHALL refuse the change.

**Test**

- **Given** bob signed up with «Small» and «A poster»
- **When** he clicks **Change answers**, empties «Where did you hear of it?», and clicks **Save changes**
- **Then** the form isn't sent, the browser points to the empty field, and the studio still shows «A poster»

**Automated:** `packages/documents/test/attendance/signups.test.ts`

## AC-5: Dietary preferences aren't asked again

WHERE an event serves food, the form for changing answers SHALL NOT ask for dietary preferences.

**Test**

- **Given** the event with **Food is served**, and bob signed up with a dietary preference
- **When** he clicks **Change answers**
- **Then** there is no «Dietary preferences (optional)» field

**Automated:** `packages/app/e2e/specs/attendance/questions.spec.ts`

## AC-6: Only one's own answers

IF someone not signed up, or a guest without the token for that signup, tries to change answers, THEN Skjera SHALL refuse it.

**Automated only:** the page only offers to change one's own signup. `packages/documents/test/attendance/signups.test.ts`

## AC-7: Not after sign-up closes

WHILE sign-up has closed, Skjera SHALL NOT let anyone change their answers.

**Test**

- **Given** bob signed up
- **When** you set **Sign-up deadline** to a time that has passed in the studio, **Publish**, and bob reloads
- **Then** there is no **Change answers**, as in SIGN-05 AC-2

**Automated:** `packages/documents/test/attendance/signups.test.ts`

## AC-8: From another browser too

WHEN a guest opens **Change answers** in a browser other than the one they signed up in, the form SHALL start from what they gave, and saving it unchanged SHALL keep it.

**Test**

- **Given** the event with a required question, and a guest who signed up with a phone number, a company and an answer
- **When** the guest opens **Your signup** from the email in a new private window, clicks **Change answers** and then **Save changes**
- **Then** the form held the phone number, company and answer, and the studio's **Attendees** still shows them

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/documents/test/attendance/guests.test.ts`
