# STU-24: Making a copy of an event

An organiser who wants an event like one they already have, such as this year's julebord made from last year's, can make a copy of it with **Make a copy** in the studio. The copy is a new event in the same team with the same content, ready to get a new date and be published.

**Events:** in team «STU-24: Making a copy», public events open to guests:

- «AC-1: Not published», never published.
- «AC-1 to AC-5: Julebord», published, with a summary, a cover, a text with a bold word and a link, a choice question and its own text for the sign-up email. Bob and a guest signed up. Before you copy it, add an image to its text and put someone in its list of invitations: the test data has neither.

## AC-1: Make a copy is offered on every event

The studio SHALL offer **Make a copy** in the editor's footer for every event.

**Test**

- **Given** «AC-1 to AC-5: Julebord» open in the studio
- **Then** the footer has a **Make a copy** button
- **Given** «AC-1: Not published» open in the studio
- **Then** the footer has a **Make a copy** button

**Automated:** `packages/app/e2e/specs/studio/copying.spec.ts`

## AC-2: The copy has the event's content

WHEN the organiser clicks **Make a copy**, the studio SHALL create a new, never-published event in the same team with every field of the event's content copied.

**Test**

- **Given** «AC-1 to AC-5: Julebord» open in the studio, with an image in its text
- **When** you click **Make a copy**
- **Then** the new event is in the same team, its footer says «Not published», and the team's list shows it as a draft
- **And** the title, summary, cover, times, place, tags, question and the sign-up email's subject and text are the same as in the original
- **And** the text is the same: the bold word, the link and the image with its placement, size and caption
- **And** the title has no «copy» added to it

**Automated:** `packages/documents/test/events/copying.test.ts`

## AC-3: No attendees, invitations or Slack post

WHEN a copy is made, the copy SHALL have no attendees, no invitations and no Slack post.

**Test**

- **Given** «AC-1 to AC-5: Julebord» with two signups and an invitation, and Mailpit open
- **When** you click **Make a copy**
- **Then** the copy's attendee list is empty and its list of invitations is empty
- **And** Mailpit gets no email, and nothing is posted to Slack
- **When** you publish the copy
- **Then** it is announced in Slack like any new event

**Automated:** `packages/documents/test/events/copying.test.ts`

## AC-4: The copy opens in the editor

WHEN a copy is made, the studio SHALL open the copy in the editor.

**Test**

- **Given** «AC-1 to AC-5: Julebord» open in the studio
- **When** you click **Make a copy**
- **Then** the editor shows another event in the same team, with the original's title, and the footer says «Not published»
- **And** the copy is first in the team's list

**Automated:** `packages/app/e2e/specs/studio/copying.spec.ts`

## AC-5: The event that was copied is unchanged

WHEN a copy is made, the event that was copied SHALL be unchanged.

**Test**

- **Given** «AC-1 to AC-5: Julebord» with two signups and an invitation
- **When** you click **Make a copy**, and then open «AC-1 to AC-5: Julebord» again
- **Then** it is as before: published, with the same content, its two signups and its invitation
- **And** its Publish button reads **Published** and can't be clicked, since nothing in it has changed

**Automated:** `packages/documents/test/events/copying.test.ts`

## AC-6: This page

The acceptance docs SHALL describe making a copy of an event, with a manual test for each criterion and the automated tests that check it.

**Automated only:** no test reads the acceptance docs. This page is the check.
