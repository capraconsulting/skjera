# EXT-09: Marketing consent

The sign-up form of a sales event has an optional box where those signing up can say yes to more invitations and the newsletter. A tick is sent to the contact in HubSpot, and is shown to the organisers in the studio and in the Excel file, so marketing can invite them later.

**Set-up:** for AC-2 and AC-3, a HubSpot test portal as in EXT-07, with the contact properties `invitere_til_arrangementer` and `sende_nyhetsbrev` made in it, and `Ja` as an allowed value of each. HubSpot refuses a contact with a property or a value the account lacks: the sign-up is still registered on the Marketing Event, and its ad source is still sent, but that sign-up's consent is logged and dropped, and not sent again once the properties are made. Without HubSpot set up, AC-2 and AC-3 are left to the tests.

**Events:** «AC-1 to AC-4: Sales event» and «AC-1: Not a sales event», public and open to guests.

## AC-1: The box on the sign-up form

WHERE an event is a sales event, the sign-up form SHALL have an optional, unticked checkbox for invitations and the newsletter, with a link to the privacy policy.

**Test**

- **Given** «AC-1 to AC-4: Sales event», in a private window
- **When** you open its page
- **Then** the guest form has an unticked box «Inviter meg til flere arrangementer og send meg nyhetsbrevet fra Capra», and beside it a link «Les personvernerklæringen» that opens the privacy page, without ticking the box
- **When** you leave the box unticked and sign up as a guest
- **Then** the sign-up goes through
- **When** in another private window you log in as bob and open the event
- **Then** the form with the **Attend** button has the same box and link
- **Given** «AC-1: Not a sales event», in a private window
- **When** you open its page
- **Then** the guest form has no such box

**Automated:** `packages/app/test/site/signupForm.test.ts`

## AC-2: Ticked: set in HubSpot

WHEN someone signs up with the box ticked, Skjera SHALL set `invitere_til_arrangementer` and `sende_nyhetsbrev` to `Ja` on their contact in HubSpot.

**Test**

- **Given** «AC-1 to AC-4: Sales event» published, with HubSpot set up
- **When** a guest signs up with the box ticked, and bob signs up with the box ticked
- **Then** both contacts in HubSpot have `invitere_til_arrangementer` **Ja** and `sende_nyhetsbrev` **Ja**, and both are registered on the Marketing Event

**Automated:** `packages/documents/test/notices/HubSpotSync.test.ts`, `packages/documents/test/attendance/guests.test.ts`, `packages/app/test/site/signupForm.test.ts`

## AC-3: Not ticked: nothing sent

IF the box is not ticked, THEN Skjera SHALL send nothing about consent to HubSpot.

**Test**

- **Given** «AC-1 to AC-4: Sales event» published, with HubSpot set up, and a contact in HubSpot with `invitere_til_arrangementer` **Ja** and `sende_nyhetsbrev` **Ja**
- **When** the same person signs up as a guest without ticking the box
- **Then** the contact still has **Ja** in both
- **When** someone new signs up without ticking the box
- **Then** their contact has neither property

**Automated:** `packages/documents/test/notices/HubSpotSync.test.ts`, `packages/app/test/site/signupForm.test.ts`

## AC-4: In the studio's list and the Excel file

The studio's attendee list and the Excel file SHALL show whether each person ticked the box.

**Test**

- **Given** «AC-1 to AC-4: Sales event» with a guest who ticked the box and another who did not
- **When** you open the event in the studio, and click **Download Excel**
- **Then** the list shows the mark «Invitasjoner og nyhetsbrev» on the first guest's row only, and the file has a column «Invitasjoner og nyhetsbrev» after the others and before the questions, reading **Ja** for the first guest and **Nei** for the other

**Automated:** `packages/app/test/studio/attendeesSheet.test.ts` (the column), `packages/documents/test/attendance/guests.test.ts` (the value the list shows)
