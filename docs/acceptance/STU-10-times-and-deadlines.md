# STU-10: Times, time zone and deadlines

An event has a start and an end in a time zone, and can have a sign-up deadline and a food deadline. Each is set as a day and a time on the clock in the event's time zone.

**Events:** in team «STU-10: Times, time zone and deadlines», one public event per criterion, with a title and a place. Your computer's time zone is Norway's.

## AC-1: Start and end, two hours by default

The studio SHALL let an organiser set an event's start and end as a day and a time, SHALL give a first start an end two hours later, and SHALL move the end with the start when the start changes.

**Test**

- **Given** «AC-1: Start and end» open in the studio, with no times
- **When** you pick a day next month under **Starts**
- **And** you change **Start time** to 18:00
- **Then** it starts at 17:00 and ends at 19:00 the same day; then it starts at 18:00 and ends at 20:00

**Automated:** `packages/app/e2e/specs/collaboration.spec.ts`, `packages/app/e2e/specs/site.spec.ts`

## AC-2: The time zone is the organiser's own

The studio SHALL put a new event in the organiser's own time zone.

**Test**

- **Given** «AC-2: Own zone», with a start and an end
- **When** you look at **Time zone**, then publish it and open it on the site
- **Then** it says «Europe/Oslo», and the site shows the hours without naming a zone

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-3: Another zone keeps the clock

WHEN an organiser picks another time zone, the studio SHALL keep the event's times on the same hour of the clock, now in that zone.

**Test**

- **Given** «AC-3: New York», starting at 18:00 and ending at 20:00
- **When** you pick «America/New York» in **Time zone**
- **Then** **Start time** is still 18:00 and **End time** 20:00

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-4: An optional sign-up deadline

The studio SHALL let an organiser set a sign-up deadline, and clear it again.

**Test**

- **Given** «AC-4: Deadline», with a start
- **When** you pick a day under **Sign-up deadline**
- **And** you click **Clear** beside it
- **Then** the deadline is set at 12:00 on the day picked, and is empty again after **Clear**, with «Pick a date» shown

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-5: An optional food deadline

WHERE an event serves food, the studio SHALL let an organiser set a food deadline, and clear it again.

**Test**

- **Given** «AC-5: Food deadline», with a start
- **When** you tick **Food is served**, and pick a day under the food deadline that appears
- **And** you click **Clear** beside it
- **Then** the food deadline is set at 12:00 on the day picked, and is empty again after **Clear**

**Automated:** none

## AC-6: Only times that exist

IF a time doesn't exist in its time zone, such as an hour skipped when the clocks go forward, THEN Skjera SHALL refuse it.

**Automated only:** the studio's time fields only make times that exist. `packages/documents/test/events/drafts.test.ts`
