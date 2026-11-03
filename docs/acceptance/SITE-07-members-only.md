# SITE-07: Members-only events

An event without **Public event** ticked is for members only: those logged in see it listed, and anyone with its address can open it, but only a member can sign up.

**Events:**

- «AC-1: Members only», with **Public event** unticked, published.
- «AC-3: Made members-only», public, published.

What a shared link to a members-only event shows is in [SITE-08](SITE-08-summary-and-sharing.md), who sees the names of those signed up in [SITE-06](SITE-06-whos-coming.md), and why guests can't sign up for it in [STU-12](STU-12-visibility.md) AC-4.

## AC-1: Not listed for those not logged in

WHILE no one is logged in, the site SHALL NOT list a members-only event on the front page.

**Test**

- **Given** «AC-1: Members only»
- **When** you open the front page in a private window
- **Then** the event isn't listed

**Automated:** `packages/app/e2e/specs/attendance/members.spec.ts`, `packages/documents/test/attendance/signups.test.ts`, `packages/documents/test/server/Sync.test.ts`

## AC-2: Shown to members, marked as such

WHILE a member is logged in, the site SHALL list members-only events with the others, and their pages SHALL say «Members only».

**Test**

- **Given** «AC-1: Members only»
- **When** bob opens the front page, and clicks the event
- **Then** it is listed, marked «Members only», and its page opens, saying «Members only»

**Automated:** `packages/app/e2e/specs/attendance/members.spec.ts`

## AC-3: Made members-only, it leaves open pages

WHEN a public event is made members-only and published again, the site SHALL take it off the front page of those not logged in without a reload, and bring it back the same way when it is made public again.

**Test**

- **Given** «AC-3: Made members-only», with the front page open in a private window
- **When** you untick **Public event** in the studio, and **Publish**
- **Then** within a few seconds the event is gone from the private window's front page, without a reload
- **When** you tick **Public event** again, and **Publish**
- **Then** it comes back the same way

**Automated:** `packages/app/e2e/specs/site.spec.ts`, `packages/documents/test/server/Sync.test.ts`

## AC-4: Its address opens it, asking to log in

WHEN someone not logged in opens the address of a published members-only event, the site SHALL show the event's page, with «You need to log in to sign up for this event» and a **Log in** button where the sign-up form would be, and SHALL NOT show who has signed up; WHEN they log in from that button, the site SHALL take them back to the event.

**Test**

- **Given** «AC-1: Members only»
- **When** you open the event's address in a private window
- **Then** the page shows its title, time, place, text and image, and says «Members only»; in place of a sign-up form it says «You need to log in to sign up for this event» with a **Log in** button, and no names of those signed up
- **When** you click **All events**
- **Then** the event isn't listed
- **When** you open the event's address again, click **Log in**, and log in as bob
- **Then** you are back on the event's page, offered **Attend**
- **When** someone unpublishes the event while the private window has it open
- **Then** within a few seconds the page says «This event doesn't exist, or isn't published.»

**Automated:** `packages/app/e2e/specs/attendance/members.spec.ts`, `packages/documents/test/server/Sync.test.ts`
