# STU-12: Who sees the event, and whether guests can sign up

An event is either public or for members only, and a public event can let guests sign up without an account. Both are set under **Visibility** in the studio.

**Events:** in team «STU-12: Who sees the event, and whether guests can sign up»:

- «AC-1: New», a new event, left as it is.
- «AC-2 and AC-3: Members only», published with **Public event** unticked.
- «AC-4 and AC-5: Open to guests», published with **Public event** and **Guests can sign up** ticked.
- «AC-5: Public, no guests», published with **Public event** ticked and **Guests can sign up** unticked.

## AC-1: A new event is for members only

Skjera SHALL create a new event as members only, with guests not able to sign up.

**Test**

- **Given** the studio
- **When** you click **New event** and look under **Visibility**
- **Then** **Public event** and **Guests can sign up** are both unticked

**Automated:** `packages/documents/test/events/drafts.test.ts`

## AC-2: Visitors don't see a members-only event

WHILE an event is not public, Skjera SHALL hide it from anyone not logged in, on the front page and on its own page.

**Test**

- **Given** «AC-2 and AC-3: Members only», published
- **When** you open the front page and the event's address in a private window
- **Then** it isn't listed, and its page says «This event doesn't exist, or isn't published.»

**Automated:** `packages/app/e2e/specs/attendance/members.spec.ts`, `packages/documents/test/attendance/signups.test.ts`, `packages/documents/test/server/Sync.test.ts`

## AC-3: Members see it, marked as members only

WHILE an event is not public, Skjera SHALL show it to anyone logged in, marked as for members only.

**Test**

- **Given** «AC-2 and AC-3: Members only», published
- **When** bob opens the front page and the event
- **Then** it is listed, and both say «Members only»; a public event says «Open to all»

**Automated:** `packages/app/e2e/specs/attendance/members.spec.ts`, `packages/documents/test/attendance/signups.test.ts`, `packages/documents/test/server/Sync.test.ts`

## AC-4: Guests only on public events

WHILE an event is not public, Skjera SHALL not let guests sign up for it, and the studio SHALL say so at **Guests can sign up**, shown unticked and unchangeable; WHEN the event is made public again, the studio SHALL show it as the organiser last set it.

**Test**

- **Given** «AC-4 and AC-5: Open to guests» open in the studio
- **When** you untick **Public event**
- **Then** **Guests can sign up** shows unticked and can't be changed, and its hint says «Only public events can take guest signups.»
- **When** you click **Publish**, and open the event in a private window
- **Then** it says «This event doesn't exist, or isn't published.», with no form to sign up
- **When** you tick **Public event** again and click **Publish**
- **Then** **Guests can sign up** shows ticked again, and the private window offers the guest form again
- **When** you untick **Guests can sign up**, untick **Public event**, and tick **Public event** again
- **Then** **Guests can sign up** shows unticked

**Automated:** `packages/documents/test/attendance/signups.test.ts`, `packages/app/e2e/specs/attendance/guests.spec.ts`

## AC-5: Guests sign up, or are asked to log in

WHERE an event is public, the event page SHALL offer visitors the guest form if guests can sign up, and a link to log in if they can't.

**Test**

- **Given** «AC-4 and AC-5: Open to guests» and «AC-5: Public, no guests», published
- **When** you open each in a private window
- **Then** the first offers **Your name**, **Your email** and **Sign up**, and the second only «Log in to attend»

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/documents/test/attendance/guests.test.ts`

## AC-6: A change shows once published

WHEN an organiser changes who sees an event, or whether guests can sign up, Skjera SHALL apply it when the event is published again, and pages already open SHALL follow without reloading.

**Test**

- **Given** «AC-5: Public, no guests», open on the front page in a private window
- **When** you untick **Public event** in the studio, without publishing
- **Then** it is still listed in the private window
- **When** you click **Publish**
- **Then** within a few seconds it leaves the private window's front page, without reloading

**Automated:** `packages/app/e2e/specs/site.spec.ts`, `packages/documents/test/server/Sync.test.ts`
