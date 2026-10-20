# STU-13: Food, reminders and other event settings

An organiser says whether food is served and what, and whether those signed up are reminded by email the day before.

**Events:** in team «STU-13: Food, reminders and other event settings», public events open to guests:

- «AC-1 to AC-3: Food», with **Food is served** ticked and «Pizza» in **What's served**.
- «AC-3: No food», with **Food is served** unticked.
- «AC-5: Reminded», starting tomorrow at the next full hour, with **Remind attendees** ticked. At 14:20, that is tomorrow at 15:00.
- «AC-6: Not reminded», at the same time, with **Remind attendees** unticked.

## AC-1: Food is set in the studio

The studio SHALL let an organiser mark that food is served, and, while it is, write what is served.

**Test**

- **Given** «AC-1 to AC-3: Food» open in the studio
- **When** you untick **Food is served**, then tick it again
- **Then** **What's served** and the food deadline are hidden while it is unticked, and come back with «Pizza» still in **What's served**

**Automated:** `packages/app/e2e/specs/attendance/questions.spec.ts`

## AC-2: The event page says what's served

WHILE an event serves food and says what is served, the event page SHALL show what is served.

**Test**

- **Given** «AC-1 to AC-3: Food», published
- **When** you open it on the site
- **Then** it says «Food: Pizza» with the time and place
- **When** you untick **Food is served** in the studio, **Publish**, and reload the site
- **Then** «Food: Pizza» is gone
- **When** you tick **Food is served** again and **Publish**
- **Then** «Food: Pizza» is back

**Automated:** `packages/app/e2e/specs/attendance/questions.spec.ts`

## AC-3: No food, no dietary question

WHILE an event does not serve food, Skjera SHALL not ask those signing up for their dietary preferences.

**Test**

- **Given** «AC-3: No food» and «AC-1 to AC-3: Food», published
- **When** you open each in a private window
- **Then** only the event serving food asks for «Dietary preferences»

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/documents/test/attendance/dietary.test.ts`

## AC-4: Reminders are on unless turned off

Skjera SHALL create a new event with **Remind attendees** ticked.

**Test**

- **Given** the studio
- **When** you click **New event** and look under **Emails**
- **Then** **Remind attendees** is ticked, with the hint «Everyone signed up gets an email the day before.»

**Automated:** `packages/app/e2e/specs/attendance/emails.spec.ts`, `packages/documents/test/events/drafts.test.ts`, `packages/documents/test/events/content.test.ts`

## AC-5: A reminder the day before

WHERE an event reminds attendees, Skjera SHALL email each person signed up a reminder once, in the day before the event starts, unless they signed up within that day.

The server looks for events to remind about at the start of every hour.

**Test**

- **Given** «AC-5: Reminded», published, with bob signed up right away
- **When** it is a few minutes past that full hour today
- **Then** bob has one «Reminder: AC-5: Reminded» in Mailpit, saying «A reminder: you're signed up for …»
- **When** a guest signs up then, and one more full hour has passed
- **Then** the guest has no reminder, and bob still has only one

**Automated:** `packages/documents/test/notices/changes.test.tsx`

## AC-6: No reminder when turned off

IF an organiser unticks **Remind attendees**, THEN Skjera SHALL send those signed up no reminder.

**Test**

- **Given** «AC-6: Not reminded», published, with bob signed up right away
- **When** it is a few minutes past that full hour today
- **Then** bob has no «Reminder: AC-6: Not reminded» in Mailpit

**Automated:** `packages/documents/test/notices/changes.test.tsx`, `packages/documents/test/events/content.test.ts`
