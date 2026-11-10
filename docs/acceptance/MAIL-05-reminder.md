# MAIL-05: Reminder the morning before

Those signed up get a reminder the morning before the event. The **Remind attendees** setting, when the reminder is sent and who gets one are in STU-13 AC-4 to AC-7.

**Events:**

- «AC-1 to AC-3: Reminded», public and open to guests, starting the day after tomorrow at 12:00, with **Remind attendees** on **On**. Sign up bob, and one guest in a private window, right away.
- «AC-4: Deleted», the same, with bob signed up right away.

## AC-1: It says how to cancel

The reminder SHALL tell the person how to cancel, so others can take their place: a member on the event's page, a guest by their own link.

**Test**

- **Given** «Reminded», with bob and the guest signed up
- **When** the 07:05 UTC run on the morning before the event has passed
- **Then** bob's «Reminder: AC-1 to AC-3: Reminded» says «Can't make it after all? You can cancel your signup on the event's page, so others can take your place.», with **See the event**
- **And** the guest's says «Can't make it after all? Your own link cancels your signup, so others can take your place.», with **Your signup**

**Automated:** `packages/documents/test/notices/changes.test.tsx`

## AC-2: No invitation

The reminder SHALL carry no calendar invitation, as the event is already in the calendar.

**Test**

- **Given** bob's reminder from AC-1
- **When** you open it in Mailpit
- **Then** nothing is attached

**Automated:** `packages/documents/test/notices/changes.test.tsx`

## AC-3: A moved event is reminded again

WHEN an event is moved to another day after its reminder was sent, Skjera SHALL remind those signed up again the morning before the new day, of the new time.

**Test**

- **Given** «Reminded», with bob's reminder from AC-1
- **When** you change **Start date** one day later in the studio, click **Publish**, confirm with **Publish**, and wait until the 07:05 UTC run on the morning before the new day has passed
- **Then** bob has a second «Reminder: AC-1 to AC-3: Reminded», with the new time

**Automated:** `packages/documents/test/notices/changes.test.tsx`

## AC-4: No reminder for a deleted event

IF an event is deleted before its reminder is sent, THEN Skjera SHALL send no reminder for it.

**Test**

- **Given** «Deleted», with bob signed up
- **When** you delete it right away, and the 07:05 UTC run on the morning before it has passed
- **Then** bob has «Cancelled: AC-4: Deleted» in Mailpit, and no «Reminder: AC-4: Deleted»

**Automated:** `packages/documents/test/notices/changes.test.tsx`
