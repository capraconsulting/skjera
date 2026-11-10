# STU-28: History

An organiser can see an event's history in the studio with **History**: who changed it and when, an earlier version as it was, and **Restore this version** to make the draft that version again. The question before restoring is the studio's own dialog, answered with **Restore this version** or **Cancel**.

**Events:** in team «STU-28: History», public events open to guests:

- «AC-1 to AC-8: Edited by two», published by alice with the summary «Published by alice.», and then given the summary «Changed by bob.» by bob. Two people signed up.

## AC-1: The history lists the versions

The editor SHALL offer **History**, listing the event's versions newest first, each with who made the changes and when.

**Test**

- **Given** «AC-1 to AC-8: Edited by two» open in the studio as alice
- **When** you click **History**
- **Then** a dialog lists the versions, newest first: bob's change of the summary, alice's publishing, and alice's first changes
- **And** each entry says who made it, by name or else by email, and how long ago

A person Skjera has no name for is shown as «Unknown». What Skjera did on its own, such as moving a recurring event to its next date, is shown as «Skjera».

**Automated:** `packages/documents/test/events/history.test.ts`, `packages/documents/test/events/discarding.test.ts`, `packages/app/e2e/specs/studio/history.spec.ts`

## AC-2: Looking at a version

WHEN the organiser chooses a version, the studio SHALL show the event as it was then, without changing it.

**Test**

- **Given** the history of «AC-1 to AC-8: Edited by two» open
- **When** you click **View** on alice's publishing
- **Then** a new tab shows the event page with the summary «Published by alice.», under a notice saying it is an earlier version
- **And** the studio's draft still has the summary «Changed by bob.»
- **When** you change the summary in the studio
- **Then** the tab still shows «Published by alice.»
- **When** you change `version=` in the tab's address to something that is not a version
- **Then** the page says the event doesn't exist

**Automated:** `packages/app/e2e/specs/studio/history.spec.ts`, `packages/documents/test/Model.test.ts`

## AC-3: Restoring a version

WHEN the organiser chooses **Restore this version** and confirms, the studio SHALL make the draft equal to that version in every field, without publishing.

**Test**

- **Given** the history of «AC-1 to AC-8: Edited by two» open
- **When** you click **Restore this version** on alice's publishing and confirm with **Restore this version**
- **Then** without reloading, the editor shows the summary «Published by alice.», and every other field is as it was: the text with its image, the cover with its crop and focal point, the tags, the times and the questions
- **And** the site still shows what was published before
- **And** the newest entry in the history has no **Restore this version**, because it is the draft as it is

**Automated:** `packages/documents/test/events/restoring.test.ts`, `packages/app/test/studio/publishState.test.ts`, `packages/app/e2e/specs/studio/history.spec.ts`

## AC-4: Nobody is emailed

WHEN a version is restored, Skjera SHALL send no email to the event's attendees.

**Test**

- **Given** «AC-1 to AC-8: Edited by two» with Mailpit open
- **When** you restore alice's publishing
- **Then** Mailpit gets no email about the event, and its two signups are still on the attendee list

**Automated:** `packages/documents/test/events/restoring.test.ts`

## AC-5: This page

The feature files in `docs/acceptance` SHALL describe the history.

**Automated only:** no test reads the acceptance docs. This page is the check, and `packages/server/test/testdata.test.ts` checks that its events are in the test data.

## AC-6: Changes close together are one entry

The history SHALL show changes one person made close together as one entry, and each publishing as an entry of its own.

**Test**

- **Given** «AC-1 to AC-8: Edited by two» open as alice
- **When** you type in the title for a few seconds, wait a little, and type again
- **Then** the history has one new entry, not one per keystroke
- **When** you publish
- **Then** the history has an entry for the publishing, and changes after it start a new entry

Changes by the same person within ten minutes of each other, with no publishing between them, are one entry. A change by someone else, or a publishing, ends it.

**Automated:** `packages/documents/test/events/history.test.ts`, `packages/documents/test/events/recurring/moving.test.ts`, `packages/documents/test/server/migrations.test.ts`

## AC-7: A restoring is an entry

WHEN a version is restored, the history SHALL show the restoring as a new entry.

**Test**

- **Given** «AC-1 to AC-8: Edited by two» after you restored alice's publishing
- **Then** the newest entry reads «Restored an earlier version», with your name
- **When** you restore the entry below it
- **Then** the draft is as it was before the restoring

**Automated:** `packages/documents/test/events/restoring.test.ts`, `packages/documents/test/events/history.test.ts`

## AC-8: Asked before restoring

WHEN the organiser chooses **Restore this version**, the studio SHALL ask them to confirm before changing anything.

**Test**

- **Given** the history of «AC-1 to AC-8: Edited by two» open
- **When** you click **Restore this version**
- **Then** the studio asks «Restore this version? The draft becomes as it was then. Nothing is published until you publish.»
- **When** you click **Cancel**
- **Then** the draft is unchanged, also after you reload the page

**Automated:** `packages/app/e2e/specs/studio/history.spec.ts`

## AC-9: A name for every person

The history SHALL name a person by the trimmed name from their login, by their email when that name is blank, and by the login's subject when it has neither name nor email.

**Automated only:** the test logins have names and emails, so the fallback login details cannot be set by hand. `packages/oauth/test/Identity.test.ts`
