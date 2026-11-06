# EXT-08: Ad source

When a sales event is advertised on LinkedIn or Meta, the link carries a UTM code and a click id that tell which ad was clicked. Skjera keeps them for the sign-up, shows them to the organisers and sends them to the contact in HubSpot, so marketing sees which ads bring sign-ups.

**Set-up:** for AC-3 and AC-4, a HubSpot test portal as in EXT-07, with the contact properties `arr_utm_source`, `arr_utm_medium`, `arr_utm_campaign`, `arr_utm_content`, `arr_utm_term`, `arr_li_fat_id`, `arr_fbclid` and `arr_utm_arrangement` made in it (text properties). HubSpot refuses a contact with a property the account lacks: the sign-up is still registered on the Marketing Event, but that sign-up's ad source is logged and dropped, and not sent again once the properties are made. Without HubSpot set up, AC-3 and AC-4 are left to the tests.

**Events:** «AC-1 to AC-5: Sales event» and «AC-3: Not a sales event», public and open to guests.

## AC-1: The sign-up keeps the ad it came from

WHEN someone signs up after opening an event's page from an address with `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `li_fat_id` or `fbclid`, Skjera SHALL store those values with the sign-up.

**Test**

- **Given** «AC-1 to AC-5: Sales event» in a private window
- **When** you open its page with `?utm_source=linkedin&utm_campaign=spring&li_fat_id=abc` added to the address, go to the front page, open the event again from the front page, and sign up as a guest
- **Then** in the studio, the guest's row under **Attendees** says `utm_source: linkedin, utm_campaign: spring, li_fat_id: abc`
- **When** in another private window you open the page with `?utm_source=linkedin&fbclid=F`, go to the front page, log in as bob there, open the event again from the front page and click **Attend**
- **Then** bob's row says `utm_source: linkedin, fbclid: F`

**Automated:** `packages/app/e2e/specs/attendance/ad-source.spec.ts`, `packages/app/test/adSource.test.ts`, `packages/app/test/signupForm.test.ts`, `packages/documents/test/attendance/guests.test.ts`

## AC-2: Whatever the visitor said about cookies

The values SHALL be stored whether or not the visitor has accepted cookies.

**Test**

- **Given** «AC-1 to AC-5: Sales event», and a private window where cookies are declined (or where no cookie banner is shown)
- **When** you do the first part of AC-1 there
- **Then** the guest's row has the same values

**Automated:** `packages/app/e2e/specs/attendance/ad-source.spec.ts` (a site that has asked nothing about cookies)

## AC-3: Sent to the contact in HubSpot

WHEN someone signs up to a sales event with stored values, Skjera SHALL send them to the contact in HubSpot as `arr_utm_source`, `arr_utm_medium`, `arr_utm_campaign`, `arr_utm_content`, `arr_utm_term`, `arr_li_fat_id` and `arr_fbclid`, with the event's title as `arr_utm_arrangement`.

**Test**

- **Given** «AC-1 to AC-5: Sales event» published, with HubSpot set up
- **When** a guest signs up from an address with `?utm_source=linkedin&utm_campaign=spring&li_fat_id=abc`
- **Then** the contact in HubSpot has `arr_utm_source` **linkedin**, `arr_utm_campaign` **spring**, `arr_li_fat_id` **abc** and `arr_utm_arrangement` with the event's title
- **When** you tick **Sales event (send to HubSpot)** on an event that already has such sign-ups, and publish
- **Then** their contacts get the same properties
- **Given** «AC-3: Not a sales event»
- **When** a guest signs up to it from an address with `?utm_source=linkedin`
- **Then** nothing reaches HubSpot, and the studio shows `utm_source: linkedin` on the guest's row

**Automated:** `packages/documents/test/notices/HubSpotSync.test.ts`, `packages/hubspot/test/HubSpot.test.ts`

## AC-4: A missing value is not sent

IF a value is missing from a sign-up, THEN Skjera SHALL NOT send that property to HubSpot.

**Test**

- **Given** «AC-1 to AC-5: Sales event», and a contact in HubSpot with `arr_utm_source` **meta** and `arr_utm_campaign` **autumn**
- **When** the same person signs up from an address with only `?utm_source=linkedin`
- **Then** `arr_utm_source` is **linkedin** and `arr_utm_campaign` is still **autumn**
- **When** someone signs up with no ad in the address
- **Then** the contact gets no `arr_` property, not even `arr_utm_arrangement`

**Automated:** `packages/documents/test/notices/HubSpotSync.test.ts`

## AC-5: In the studio's list and the Excel file

WHERE a sign-up has a source, the studio's attendee list and the Excel file SHALL show it.

**Test**

- **Given** «AC-1 to AC-5: Sales event» with the guest of AC-1 signed up, and another guest who signed up without an ad
- **When** you open the event in the studio, and click **Download Excel**
- **Then** the list shows `utm_source: linkedin, utm_campaign: spring, li_fat_id: abc` on the first guest's row only, and the file has the columns `utm_source`, `utm_campaign` and `li_fat_id` after the others and before the questions, filled for the first guest and empty for the other

**Automated:** `packages/app/e2e/specs/attendance/ad-source.spec.ts` (the list), `packages/app/test/attendeesSheet.test.ts` (the columns)

## AC-6: The privacy page says so

The privacy page SHALL say that the ad source is stored with a sign-up.

**Test**

- **When** you open `/privacy`, in each language
- **Then** the section on sign-ups says that the ad you came from is stored with your sign-up, the paragraph on what the browser keeps says that the codes of the ad are kept for the event whatever you choose about cookies, and, when HubSpot is set up for sales events, the line on HubSpot says that the ad is sent for sales events

**Automated:** none
