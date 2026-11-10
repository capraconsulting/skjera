# MAIL-08: Email to everyone signed up

An organiser can write to everyone signed up to an event from the studio, for a change of room or what to bring. The attendee list has «Email those signed up», which opens a form with a subject and a text and sends one email to each person signed up, members and guests, with the organiser as reply-to. The studio keeps a list of the emails sent for the event. The attendee list is SIGN-11, and when the emails are deleted is SIGN-13.

**Events:**

- «AC-1 to AC-5: Signed up», public and open to guests. Sign up bob, and one guest in a private window.
- «AC-1: Nobody signed up», public and open to guests, with nobody signed up.

## AC-1: Offered while someone is signed up

WHILE an event has people signed up, the studio's attendee list SHALL offer «Email those signed up», with a subject, a text and the number of recipients. It SHALL NOT offer it while nobody signed up has an email address.

**Test**

- **Given** «Nobody signed up» open in the studio
- **When** you look at the attendee list
- **Then** it has «Download Excel» only when someone is signed up, and no «Email those signed up»
- **Given** «Signed up», with bob and the guest signed up
- **When** you click **Email those signed up**
- **Then** a form opens with **Subject**, **Message** and «Goes to 2 signed up»

**Automated:** `packages/app/e2e/specs/attendance/organizer-email.spec.ts`, `packages/app/test/studio/organizerEmails.test.ts`, `packages/documents/test/notices/organizerEmails.test.ts`

## AC-2: One email to each, from the organiser

WHEN the organiser confirms the sending, Skjera SHALL send one email to each person signed up, with the organiser as reply-to and the event's title and link after the text.

**Test**

- **Given** the form open on «Signed up»
- **When** you write «Nytt rom» as the subject and «Vi er i rom 3.» as the message, click **Send**, and answer Cancel to «Send the email to 2 signed up?»
- **Then** the form is still open and Mailpit at http://localhost:8025 has no «Nytt rom»
- **When** you click **Send** again and confirm with **Send** in the dialog
- **Then** the form closes, the studio says «The email is being sent to 2 signed up», and bob and the guest each get one email «Nytt rom» in Mailpit
- **When** you open bob's email
- **Then** it has «Vi er i rom 3.», followed by «AC-1 to AC-5: Signed up» and a button «See the event» to the event's page, and it is from the site's address with your name and email as reply-to

**Automated:** `packages/app/e2e/specs/attendance/organizer-email.spec.ts`, `packages/documents/test/notices/organizerEmails.test.ts`

## AC-3: Nothing is sent without a subject and a text

IF the subject or the text is empty, THEN the studio SHALL NOT send.

**Test**

- **Given** the form open on «Signed up»
- **When** you click **Send** with the subject empty, and then with a subject and only spaces as the message
- **Then** «Write a subject» is shown, and then «Write a message», no question is asked and Mailpit has nothing new

**Automated:** `packages/app/test/studio/organizerEmails.test.ts`, `packages/documents/test/notices/organizerEmails.test.ts`, `packages/documents/test/api/Problems.test.ts`

## AC-4: The list of emails sent

WHEN an email has been sent, the studio SHALL list it for the event with when, by whom, the subject and how many got it.

**Test**

- **Given** the email from AC-2 sent
- **When** you look under the attendee list
- **Then** «Sent emails (1)» lists «Nytt rom», when it was sent, your name, and «Sent to 2»
- **When** you send a second email, and reload the event
- **Then** both are listed, the newest first

**Automated:** `packages/app/e2e/specs/attendance/organizer-email.spec.ts`, `packages/documents/test/notices/organizerEmails.test.ts`

## AC-5: Nobody who left gets it

Nobody who has cancelled or been taken off SHALL get the email.

**Test**

- **Given** «Signed up», with the guest having cancelled from the link in their email
- **When** you open the form
- **Then** it says «Goes to 1 signed up»
- **When** you send an email
- **Then** only bob gets it, and the list says «Sent to 1»

**Automated:** `packages/documents/test/notices/organizerEmails.test.ts`
