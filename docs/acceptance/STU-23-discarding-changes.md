# STU-23: Discarding changes

An organiser who has edited a published event and changed their mind can go back to the published version with **Discard changes** in the studio, instead of putting every field back by hand. The question before discarding is the browser's own, answered with **OK** or **Cancel**.

**Events:** in team «STU-23: Discarding changes», public events open to guests:

- «AC-2: Not published», never published.
- «AC-3 to AC-7: Changed», published, with a title, a summary and a text with a bold word, a link and an image, then edited: another title, summary and text, the image's caption changed, and a tag added. Two people signed up before the edit.
- «AC-1 to AC-2: Up to date», published and not edited since.

## AC-1: Discard changes is offered on a changed event

WHILE a published event has changes not yet published, the studio SHALL offer **Discard changes** in the editor's footer.

**Test**

- **Given** «AC-1 to AC-2: Up to date» open in the studio
- **Then** there is no **Discard changes** button
- **When** you add an exclamation mark to the title
- **Then** there is a **Discard changes** button, as soon as the footer says «Saved»

**Automated:** `packages/app/e2e/specs/studio/discarding.spec.ts`, `packages/app/test/studio/publishState.test.ts`

## AC-2: Nothing to discard

WHILE an event has never been published, or has no changes since it was, the studio SHALL NOT offer **Discard changes**.

**Test**

- **Given** «AC-2: Not published» open in the studio
- **Then** there is no **Discard changes** button
- **Given** «AC-1 to AC-2: Up to date» open in the studio
- **Then** there is no **Discard changes** button

**Automated:** `packages/app/test/studio/publishState.test.ts`, `packages/app/e2e/specs/studio/discarding.spec.ts`

## AC-3: Asked before discarding

WHEN an organiser clicks **Discard changes**, the studio SHALL ask first, and SHALL keep the changes if the answer is no.

**Test**

- **Given** «AC-3 to AC-7: Changed» open in the studio
- **When** you click **Discard changes**
- **Then** the browser asks «Discard the changes that aren't published? The event goes back to how it is published, and the changes are lost.»
- **When** you click **Cancel**
- **Then** the changed title is still there, also after you reload the page

**Automated:** `packages/app/e2e/specs/studio/discarding.spec.ts`

## AC-4: The draft is the published version again

WHEN the organiser confirms, the studio SHALL make the event's draft equal to its published version in every field, the text and the images included.

**Test**

- **Given** «AC-3 to AC-7: Changed» open in the studio
- **When** you click **Discard changes** and **OK**
- **Then** the title, the summary, the tags and the times are as published
- **And** the text is as published: the bold word, the link and the image with its placement, size and caption
- **When** you type right after the link's last letter
- **Then** the new text is not part of the link
- **When** you click **View on site**
- **Then** the page shows the same as the studio

**Automated:** `packages/documents/test/events/discarding.test.ts`

## AC-5: Nobody is emailed

WHEN changes are discarded, Skjera SHALL send no email to the event's attendees.

**Test**

- **Given** «AC-3 to AC-7: Changed», after you moved it to another day and another place, with Mailpit open
- **When** you click **Discard changes** and **OK**
- **Then** Mailpit gets no email about the event, and its two signups are still on the attendee list

**Automated:** `packages/documents/test/events/discarding.test.ts`

## AC-6: This page

The acceptance docs SHALL describe discarding changes, with a manual test for each criterion and the automated tests that check it.

**Automated only:** no test reads the acceptance docs. This page is the check.

## AC-7: The footer says published and up to date

WHEN changes are discarded, the editor's footer SHALL say that the event is published and up to date.

**Test**

- **Given** «AC-3 to AC-7: Changed» open in the studio
- **When** you click **Discard changes** and **OK**
- **Then** without reloading, the editor shows the published title, the footer says «Published just now», the Publish button reads **Published** and can't be clicked, and **Discard changes** is gone
- **And** the team's list shows the event as «Published», not «Changed»

The time the footer shows is the time of the discard, not the time of the earlier publishing: discarding publishes the event again at the draft's new version, in the name of whoever published it last. A calendar invitation sent later carries a higher sequence number for the same reason.

**Automated:** `packages/app/e2e/specs/studio/discarding.spec.ts`, `packages/app/test/studio/publishState.test.ts`
