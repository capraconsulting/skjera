# STU-27: Moving an event to another team

An event started in the wrong team can be moved to the right one, with **Organizer** in the studio's editor, until it is first published. From then on **Organizer** shows the team and cannot be changed, also if the event is unpublished.

**Events:** in team «STU-27: Moving an event», events open to guests:

- «AC-1 to AC-3 and AC-7: Never published», never published.
- «AC-4: Published», published. To try it after unpublishing, unpublish it in the test.

Team «STU-27: The other team» has no events, to move to. Team «STU-27: The wrong team» has the event «AC-5: Made in the wrong team», never published: move it out in the test, and then delete the team.

## AC-1: The editor shows the organiser

The editor SHALL show **Organizer** with the event's team chosen.

**Test**

- **Given** «AC-1 to AC-3 and AC-7: Never published» open in the studio
- **Then** the editor has **Organizer** above the title, with «STU-27: Moving an event» chosen
- **And** the choice lists every team, «STU-27: The other team» among them

**Automated:** `packages/app/e2e/specs/moving.spec.ts`

## AC-2: Until the first publish, the organiser can be changed

WHILE an event has never been published, the studio SHALL let the organiser choose another team as **Organizer**.

**Test**

- **Given** «AC-1 to AC-3 and AC-7: Never published» open in the studio
- **When** you choose «STU-27: The other team» as **Organizer**
- **Then** the choice is changed, and no error is shown
- **Given** the event is a copy of a published event, which has never been published itself
- **Then** its **Organizer** can be changed in the same way

**Automated:** `packages/documents/test/events/moving.test.ts`

## AC-3: The event belongs to the new team

WHEN another team is chosen, the studio SHALL move the event to that team's list and show that team as its organiser.

**Test**

- **Given** «AC-1 to AC-3 and AC-7: Never published» open in the studio, with «STU-27: The other team» chosen as **Organizer**
- **Then** the list of «STU-27: The other team» has the event, and the list of «STU-27: Moving an event» does not
- **And** the editor stays open on the event, with the same text in it
- **When** you click **Preview**
- **Then** the preview shows «STU-27: The other team» as the organiser, with its logo if it has one

**Automated:** `packages/app/e2e/specs/moving.spec.ts`, `packages/documents/test/server/Sync.test.ts`

## AC-4: After the first publish, the organiser is fixed

WHILE an event has been published at least once, the studio SHALL NOT let the organiser change **Organizer**.

**Test**

- **Given** «AC-4: Published» open in the studio
- **Then** **Organizer** shows «STU-27: Moving an event» and cannot be changed
- **And** it says that the organizer can't be changed once the event has been published
- **When** you click **Unpublish** and confirm
- **Then** **Organizer** still cannot be changed
- **When** you publish the event again
- **Then** **Organizer** still cannot be changed

**Automated:** `packages/app/e2e/specs/moving.spec.ts`, `packages/documents/test/events/moving.test.ts`, `packages/documents/test/server/migrations.test.ts`

## AC-5: The old address leads to the new team

WHEN a moved event is opened from its old address, the studio SHALL open it in its new team.

**Test**

- **Given** «AC-5: Made in the wrong team» open in the studio, with its address copied
- **When** you choose «STU-27: The other team» as **Organizer**
- **And** open the copied address
- **Then** the editor opens the event under «STU-27: The other team»'s address
- **When** you delete the team «STU-27: The wrong team», which has no events now, and open the copied address again
- **Then** the editor opens the event under «STU-27: The other team»'s address, and not «This team doesn't exist anymore.»

**Automated:** `packages/app/e2e/specs/teams.spec.ts`, `packages/app/e2e/specs/moving.spec.ts`

## AC-6: This page

The acceptance docs SHALL describe the choice of organiser, with a manual test for each criterion and the automated tests that check it.

**Automated only:** no test reads the acceptance docs. This page is the check.

## AC-7: Others follow the event

WHEN an event is moved to another team, the studio SHALL keep the editor open on it under the new team's address, for the organiser and for others who have it open.

**Test**

- **Given** «AC-1 to AC-3 and AC-7: Never published» open in the studio in two browsers, signed in as Alice and as Bob
- **When** Alice chooses «STU-27: The other team» as **Organizer**
- **Then** Alice's editor stays open on the event under the new team's address
- **And** within a few seconds Bob's editor is on the new team's address too, without a reload, with **Organizer** showing the new team and what he had typed still there

**Automated:** `packages/app/e2e/specs/moving.spec.ts`
