# SITE-07: Members-only events

An event without **Public event** ticked is for members only: those logged in see it, and to everyone else it isn't there.

**Events:**

- «AC-1: Members only», with **Public event** unticked, published.
- «AC-3: Made members-only», public, published.

What a shared link to a members-only event shows is in [SITE-08](SITE-08-summary-and-sharing.md), who sees the names of those signed up in [SITE-06](SITE-06-whos-coming.md), and why guests can't sign up for it in [STU-12](STU-12-visibility.md) AC-4.

## AC-1: Hidden from those not logged in

WHILE no one is logged in, the site SHALL NOT list a members-only event, and its page SHALL say «This event doesn't exist, or isn't published.»

**Test**

- **Given** «AC-1: Members only»
- **When** you open the front page in a private window, and then the event's address
- **Then** the event isn't listed, and its page says «This event doesn't exist, or isn't published.»

**Automated:** `packages/app/e2e/specs/attendance/members.spec.ts`, `packages/documents/test/attendance/signups.test.ts`, `packages/documents/test/server/Sync.test.ts`

## AC-2: Shown to members, marked as such

WHILE a member is logged in, the site SHALL list members-only events with the others, and their pages SHALL say «Members only».

**Test**

- **Given** «AC-1: Members only»
- **When** bob opens the front page, and clicks the event
- **Then** it is listed, marked «Members only», and its page opens, saying «Members only»

**Automated:** `packages/app/e2e/specs/attendance/members.spec.ts`

## AC-3: Made members-only, it leaves open pages

WHEN a public event is made members-only and published again, the site SHALL take it off the pages of those not logged in without a reload, and bring it back the same way when it is made public again.

**Test**

- **Given** «AC-3: Made members-only», with the front page open in a private window
- **When** you untick **Public event** in the studio, and **Publish**
- **Then** within a few seconds the event is gone from the private window's front page, without a reload
- **When** you tick **Public event** again, and **Publish**
- **Then** it comes back the same way

**Automated:** `packages/app/e2e/specs/site.spec.ts`, `packages/documents/test/server/Sync.test.ts`
