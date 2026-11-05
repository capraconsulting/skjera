# SITE-05: The event page

Each published event has a page of its own on the site, with what was published for it.

**Events:**

- «AC-1: Times», public, tomorrow from 18:00 to 20:00, with **Time zone** «America/New York».
- «AC-2: Text», public, with a cover image, the tag «Workshop», and text with a heading, bold words, a list and a link.
- «AC-3: Food», public, with **Food is served** ticked and «Pizza» under **What's served**.
- «AC-5: Deleted», public, published, then deleted with **Delete**. Note its id, the end of its address in the studio, before deleting it.
- «AC-5: Draft», public, never published. Note its id the same way.

What else the page shows is in its own file: the place in [STU-11](STU-11-place.md), the stream in [SIGN-07](SIGN-07-streaming.md), the organiser in [STU-02](STU-02-organiser-logo.md), the summary in [SITE-08](SITE-08-summary-and-sharing.md), who's coming in [SITE-06](SITE-06-whos-coming.md), and that later edits stay off the page until published in [STU-17](STU-17-publishing.md) AC-4.

## AC-1: The day and hours, in the event's time zone

The event page SHALL show the day and the hours of the event in its own time zone, and name that zone when it isn't the reader's.

**Test**

- **Given** «AC-1: Times», read on a computer in Norway
- **When** you open it on the site
- **Then** it shows tomorrow's date and «6:00 – 8:00 PM (ET)»
- **When** you set **Time zone** to «Europe/Oslo» in the studio, **Publish**, and reload
- **Then** it shows «6:00 – 8:00 PM», with no zone

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-2: Title, cover, tags and text

The event page SHALL show the event's title, cover image, tags and text as formatted in the studio.

**Test**

- **Given** «AC-2: Text»
- **When** you open it on the site
- **Then** it shows the title, the cover, «Workshop», and the text with its heading, bold words, list and link as written

**Automated:** `packages/app/e2e/specs/site.spec.ts`, `packages/app/e2e/specs/images.spec.ts`

## AC-3: What's served

WHERE food is served and what's served is written, the event page SHALL show it as «Food».

**Test**

- **Given** «AC-3: Food»
- **When** you open it on the site
- **Then** it says «Food: Pizza»
- **When** you untick **Food is served** in the studio, **Publish**, and reload
- **Then** «Food» is gone

**Automated:** `packages/app/e2e/specs/attendance/questions.spec.ts`

## AC-4: Back to all events

The event page SHALL have an **All events** link to the front page.

**Test**

- **Given** any published event
- **When** you open it, and click **All events**
- **Then** the front page opens

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-5: An event that isn't there

IF the address names no published event, as when it is unknown, a draft never published, or deleted, THEN the event page SHALL say «This event doesn't exist, or isn't published.»

**Test**

- **Given** «AC-5: Deleted» and «AC-5: Draft»
- **When** you open http://localhost:5173/events/<id> with each one's id, and http://localhost:5173/events/nothing
- **Then** each says «This event doesn't exist, or isn't published.»

**Automated:** `packages/app/e2e/specs/site.spec.ts`, `packages/app/e2e/specs/attendance/emails.spec.ts`
