# STU-13: Food, reminders and other event settings

An organiser says whether food is served and what, and whether those signed up are reminded by email the morning before.

**Events:** in team «STU-13: Food, reminders and other event settings», public events, open to guests unless said:

- «AC-1 to AC-3: Food», with **Food is served** ticked and «Pizza» in **What's served**.
- «AC-3: No food», with **Food is served** unticked.
- «AC-5: Standard, open to guests», starting the day after tomorrow at 12:00, with **Remind attendees** on **Default**.
- «AC-5: Standard, members only», the same, but not open to guests.
- «AC-6: On, members only», the same, not open to guests, with **Remind attendees** on **On**.
- «AC-6: Off, open to guests», the same, open to guests, with **Remind attendees** on **Off**.

Each reminder event has bob signed up.

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

## AC-4: Reminders follow the choice, Default for a new event

The studio SHALL offer **Remind attendees** as **Default**, **On** or **Off**, and Skjera SHALL create a new event with **Default**.

**Test**

- **Given** the studio
- **When** you click **New event** and look under **Emails**
- **Then** **Remind attendees** shows **Default**, with the hint «Default means on for events guests can sign up for, and off for the others. Everyone signed up gets an email the morning before.»
- **When** you open the choices
- **Then** they are **Default**, **On** and **Off**
- **When** you choose **On** and reload the page
- **Then** **On** is still chosen

**Automated:** `packages/app/e2e/specs/attendance/emails.spec.ts`, `packages/documents/test/events/drafts.test.ts`, `packages/documents/test/events/content.test.ts`

## AC-5: Default reminds events open to guests

WHILE **Remind attendees** is on **Default**, Skjera SHALL remind those signed up for an event guests can sign up for, and nobody signed up for one they can't.

**Test**

- **Given** «AC-5: Standard, open to guests» and «AC-5: Standard, members only», published, each with bob signed up right away
- **When** the 07:05 UTC run on the morning before the events has passed
- **Then** bob has one «Reminder: AC-5: Standard, open to guests» in Mailpit, saying «A reminder: you're signed up for …»
- **And** bob has no «Reminder: AC-5: Standard, members only»

**Automated:** `packages/documents/test/events/content.test.ts`, `packages/documents/test/notices/changes.test.tsx`

## AC-6: On always reminds, Off never does

WHILE **Remind attendees** is on **On**, Skjera SHALL remind those signed up whether guests can sign up or not. WHILE it is on **Off**, Skjera SHALL send them no reminder.

**Test**

- **Given** «AC-6: On, members only» and «AC-6: Off, open to guests», published, each with bob signed up right away
- **When** the 07:05 UTC run on the morning before the events has passed
- **Then** bob has one «Reminder: AC-6: On, members only» in Mailpit
- **And** bob has no «Reminder: AC-6: Off, open to guests»

**Automated:** `packages/documents/test/events/content.test.ts`, `packages/documents/test/notices/changes.test.tsx`

## AC-7: Reminders go out in the morning before

WHEN it is 07:05 UTC, Skjera SHALL email each person signed up for an event starting the next calendar day in Norway a reminder, including those who signed up the same day, and once for each time the event starts.

The server looks for events to remind about once a day, at 07:05 UTC. Someone who signs up after that morning's run is not reminded. Moving an event to another day reminds those signed up again the morning before the new day; moving it to another time on the same day does not.

**Test**

- **Given** «AC-5: Standard, open to guests», published, with bob signed up right away, and a guest who signs up in a private window the morning before the event, before the run
- **When** the 07:05 UTC run on the morning before the event has passed
- **Then** bob and the guest each have one «Reminder: AC-5: Standard, open to guests» in Mailpit
- **When** the next day's run passes
- **Then** neither has a second one

**Automated:** `packages/documents/test/notices/changes.test.tsx`
