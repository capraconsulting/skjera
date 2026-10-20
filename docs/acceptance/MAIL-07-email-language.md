# MAIL-07: Emails in the language you signed up in

Each email about an event is in the language the site was in when the person signed up: English, Bokmål or Nynorsk.

**Events:** «AC-1 to AC-4: Languages», public and open to guests.

## AC-1: The first email is in the language signed up in

WHEN someone signs up for an event, Skjera SHALL send the confirmation in the language the site was in when they signed up.

**Test**

- **Given** «Languages»
- **When** a guest picks Bokmål in the header and signs up with **Meld meg på**
- **And** another guest, in a new private window, picks Nynorsk and signs up
- **Then** the first gets «Du er påmeldt: AC-1 to AC-4: Languages» and the second «Du er påmeld: AC-1 to AC-4: Languages», each starting «Hei <name>,»

**Automated:** `packages/app/e2e/specs/language.spec.ts`, `packages/documents/test/notices/signups.test.tsx`

## AC-2: Later emails stay in that language

WHEN Skjera emails someone again about an event they are signed up for, the email SHALL be in the language they signed up in, whatever language the site is in by then.

**Test**

- **Given** the Bokmål guest from AC-1, who then picks English in the header
- **When** you change **Start time** in the studio, click **Publish** and answer OK
- **Then** the guest gets «Nytt tidspunkt: AC-1 to AC-4: Languages», in Bokmål

**Automated:** `packages/documents/test/notices/signups.test.tsx`

## AC-3: Dates as the language writes them

Every email SHALL write the event's time as the person's language writes it, in the event's time zone, with the time zone named.

**Test**

- **Given** the Bokmål guest's email from AC-1
- **When** you read it
- **Then** the time reads like «onsdag 15. oktober 2036, 18:00–21:00 (sentraleuropeisk tid)»

**Automated:** `packages/documents/test/notices/signups.test.tsx`

## AC-4: A member's language from Account settings

WHEN a member has picked a language under **Language** in **Account settings** and then signs up, Skjera SHALL email them in that language.

**Test**

- **Given** «Languages», and bob with Nynorsk picked under **Language** in **Account settings**
- **When** bob signs up with **Meld meg på**
- **Then** he gets «Du er påmeld: AC-1 to AC-4: Languages», in Nynorsk

**Automated:** none
