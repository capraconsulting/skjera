# SITE-09: The site updates without reloading

An open page on the site follows what is published and who signs up, without being reloaded. It checks for changes every five seconds, so a change shows within a few seconds.

**Events:** public events, one per criterion. For each test, keep the site open in a private window and change the event in the studio in another.

A members-only event leaving open pages is in [SITE-07](SITE-07-members-only.md), the lists of who's coming in [SITE-06](SITE-06-whos-coming.md), and a team's new name or logo in [STU-02](STU-02-organiser-logo.md).

## AC-1: A new event appears

WHEN an event is published for the first time, the site SHALL show it on open front pages without a reload.

**Test**

- **Given** the front page open in a private window, and a new event «AC-1: New» in the studio, ready to publish
- **When** you click **Publish**
- **Then** «AC-1: New» appears on the front page within a few seconds

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-2: A change, published again, follows

WHEN a published event is changed and published again, the site SHALL show the change on open pages without a reload.

**Test**

- **Given** «AC-2: Changed», with its page open in a private window, and the front page in another
- **When** you change its title in the studio, and **Publish**
- **Then** both pages show the new title within a few seconds

**Automated:** `packages/documents/test/server/Sync.test.ts`

## AC-3: A deleted event leaves

WHEN a published event is deleted, the site SHALL take it off open front pages, and its open page SHALL say «This event doesn't exist, or isn't published.», without a reload.

**Test**

- **Given** «AC-3: Deleted», with its page open in a private window, and the front page in another
- **When** you delete it in the studio with **Delete**
- **Then** within a few seconds it is gone from the front page, and its page says «This event doesn't exist, or isn't published.»

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-4: The count follows sign-ups

WHEN someone signs up for an event or cancels, its open pages SHALL show the new number attending without a reload.

**Test**

- **Given** «AC-4: Count», with its page open in a private window
- **When** bob signs up in his window
- **Then** the private window says «1 attending» within a few seconds
- **When** bob cancels
- **Then** the number is gone again

**Automated:** `packages/app/e2e/specs/attendance/whos-coming.spec.ts`

## AC-5: A server that is restarting

IF the server doesn't answer for a while, as when it restarts, THEN the site SHALL keep asking, and carry on once it answers.

**Automated only:** a server that answers with errors for a moment is hard to make by hand. `packages/app/e2e/specs/site.spec.ts`, `packages/snapsync/test/client.test.ts`
