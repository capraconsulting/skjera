# SIGN-06: Maximum number of attendees

An event can take a limited number of attendees. The server enforces it, and the page says how many places are left.

**Events:** public events open to guests, each with **Maximum attendees** 2, one per criterion below. «Fill it» means: sign up bob in his window, and one guest in a private window.

## AC-1: The limit is set in the studio

The studio SHALL let an organiser set an optional maximum number of attendees for an event, and choose to hide how many places are left.

**Test**

- **Given** an event open in the studio
- **When** you set **Maximum attendees** to 2 and tick **Hide how many places are left**
- **And** you clear the number again
- **Then** both can be set and changed, and with the number cleared the event has no limit

**Automated:** `packages/app/e2e/specs/attendance/limit.spec.ts`, `packages/documents/test/attendance/limit.test.ts`

## AC-2: Members and guests both count

The limit SHALL count every attendee signed up for the event, members and guests alike.

**Test**

- **Given** an event with places for 2
- **When** bob and one guest sign up
- **Then** the page says «There are no more places.»

**Automated:** `packages/app/e2e/specs/attendance/limit.spec.ts`, `packages/documents/test/attendance/limit.test.ts`

## AC-3: A full event refuses new sign-ups

IF an event is full, THEN Skjera SHALL refuse a new sign-up, as a member or a guest, and say the event is full.

The page offers no form once it's full (AC-8), so a refusal is only seen from a form opened before.

**Test**

- **Given** an event with places for 2, open as alice and as a new guest in a private window, with both forms left open
- **When** bob and one guest fill it
- **And** alice's form and the new guest's are sent, without reloading
- **Then** both are refused with «This event is full»

**Automated:** `packages/app/e2e/specs/attendance/limit.spec.ts`, `packages/documents/test/attendance/limit.test.ts`

## AC-4: Two people, one last place

IF two people sign up at the same time for an event's last place, THEN Skjera SHALL accept one of them and refuse the other.

**Automated only:** two sign-ups at the same moment can't be made by hand. `packages/documents/test/attendance/limit.test.ts`

## AC-5: Those signed up can still change and cancel

WHILE an event is full, Skjera SHALL let those already signed up change their answers and cancel.

**Test**

- **Given** an event with places for 2 and a question, filled by bob and one guest
- **When** bob changes his answer with **Change answers** and **Save changes**
- **And** bob clicks **Cancel attendance**
- **Then** both go through while the event is full

**Automated:** `packages/app/e2e/specs/attendance/limit.spec.ts`, `packages/documents/test/attendance/limit.test.ts`

## AC-6: A freed place can be taken

WHEN an attendee of a full event cancels, Skjera SHALL accept a new sign-up for the place that was freed.

**Test**

- **Given** an event filled by bob and one guest
- **When** bob cancels
- **And** alice opens the event on the site and clicks **Attend**
- **Then** alice is signed up, and the event is full again

**Automated:** `packages/app/e2e/specs/attendance/limit.spec.ts`, `packages/documents/test/attendance/limit.test.ts`

## AC-7: Places left are shown

WHILE sign-up for an event with a limit is open and the organiser has not hidden it, the event page SHALL show how many places are left: in the sign-up box, and for a visitor who is not logged in in the event's info list too, as «N places left». Nothing of places is said to a visitor who is not logged in about an event shown only to members, as such a visitor is sent none of its sign-ups to count.

**Test**

- **Given** an event with places for 2 and nobody signed up
- **When** you open it on the site
- **Then** the sign-up box says how many places are left
- **When** you open it in a private window
- **Then** the info list says the same, and nothing of how many are signed up
- **When** you tick **Hide how many places are left** in the studio, **Publish**, and reload the site
- **Then** the number is gone

**Automated:** `packages/app/e2e/specs/attendance/limit.spec.ts`

## AC-8: Full, in place of the form

WHILE an event is full, the event page SHALL say that there are no more places instead of offering the sign-up form.

**Test**

- **Given** an event filled by bob and one guest, with the number of places left shown, and then hidden
- **When** you open it in a new private window
- **Then** it says «There are no more places.» in place of the form, both times, and the link to log in for those signed up is still there
- **And** the info list says «No places left», also when the number of places left is hidden

**Automated:** `packages/app/e2e/specs/attendance/limit.spec.ts`

## AC-9: A limit below those signed up

IF an organiser sets the limit below the number already signed up, THEN Skjera SHALL publish the event, keep everyone signed up, and refuse new sign-ups until enough have cancelled.

**Test**

- **Given** an event filled by bob and one guest
- **When** you set **Maximum attendees** to 1 in the studio and **Publish**
- **Then** it publishes, and bob and the guest keep their places
- **When** a new guest tries to sign up, then bob and the guest cancel, and the new guest tries again
- **Then** the first try is refused, and the second goes through

**Automated:** `packages/app/e2e/specs/attendance/limit.spec.ts`, `packages/documents/test/attendance/limit.test.ts`
