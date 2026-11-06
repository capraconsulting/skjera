# EXT-07: HubSpot sales events

A sales event, such as a breakfast seminar, is kept in HubSpot as a Marketing Event, and everyone who signs up to it or cancels is sent there with the event, so marketing sees who signed up, who cancelled and which event a contact came from.

**Set-up:** a HubSpot test portal with a private app that has the scopes `crm.objects.marketing_events.read`, `crm.objects.marketing_events.write`, `crm.objects.contacts.read` and `crm.objects.contacts.write`, its token as `HUBSPOT_ACCESS_TOKEN` and `SITE_URL` under `[env]` in `mise.local.toml`. Restart `pnpm dev` after setting them. Without them AC-1 to AC-9 are left to the tests, and AC-11 is the one to try.

**Events:** «AC-1 to AC-9: Sales event» and «AC-7: Not yet a sales event», public and open to guests.

## AC-1: The studio offers the setting

WHERE an event is open to guests and `HUBSPOT_ACCESS_TOKEN` is set, the studio SHALL offer the setting «Salgsarrangement (send til HubSpot)», off for a new event.

**Test**

- **Given** the token set, and the studio open
- **When** you make a new event, and tick **Public** and **Guests can sign up**
- **Then** under the visibility there is a **Sales event (send to HubSpot)** checkbox, unticked; untick **Guests can sign up** and it goes

**Automated:** `packages/app/test/salesEvent.test.ts`, `packages/documents/test/events/content.test.ts`, `packages/documents/test/events/preview.test.ts`

## AC-2: The setting creates a Marketing Event

WHEN the setting is turned on, Skjera SHALL create a Marketing Event in HubSpot with the event's id, title, organiser, summary, start, end, address and type.

**Test**

- **Given** «AC-1 to AC-9: Sales event» with the setting on
- **When** you publish it
- **Then** HubSpot has a Marketing Event with its title, the team as organiser, the summary, the start and end, the address of the event's page, and the type **Frokostseminar**; write **Workshop** as the type, publish again, and the type is **Workshop**

**Automated:** `packages/documents/test/notices/HubSpotSync.test.ts`, `packages/hubspot/test/HubSpot.test.ts`

## AC-3: A change updates it

WHEN the title, time, place or summary of a sales event changes, Skjera SHALL update its Marketing Event.

**Test**

- **Given** the same
- **When** you change the title, the summary and the start, and publish
- **Then** the Marketing Event has the new title, summary and times

**Automated:** `packages/documents/test/notices/HubSpotSync.test.ts`

## AC-4: Cancelling the event cancels it

WHEN a sales event is cancelled, Skjera SHALL mark its Marketing Event as cancelled.

**Test**

- **Given** the same
- **When** you unpublish it, and later publish it again
- **Then** the Marketing Event is cancelled after the first, and no longer cancelled after the second

**Automated:** `packages/documents/test/notices/HubSpotSync.test.ts`

## AC-5: A sign-up registers the contact

WHEN someone signs up to a sales event, Skjera SHALL create or update the contact by email with first name, last name, company and job title, and register them on the Marketing Event with the time of the sign-up.

**Test**

- **Given** the same
- **When** a guest signs up with the name **Kari Anne Nordmann**, a company and a job title, and bob signs up too
- **Then** HubSpot has the contact for the guest with first name **Kari Anne**, last name **Nordmann**, the company and the job title, registered on the Marketing Event at the time of the sign-up, and bob registered too, without a company

**Automated:** `packages/documents/test/notices/HubSpotSync.test.ts`

## AC-6: A cancellation is recorded

WHEN someone cancels their sign-up to a sales event, or is taken off by the organiser, Skjera SHALL record them as cancelled on the Marketing Event with the time it happened.

**Test**

- **Given** the same, with a guest and bob signed up
- **When** the guest clicks **Cancel my signup**, bob clicks **Cancel attendance**, and an organiser takes a third guest off in the studio
- **Then** each is cancelled on the Marketing Event at the time it happened

**Automated:** `packages/documents/test/notices/HubSpotSync.test.ts`

## AC-7: Turning the setting on sends those already signed up

WHEN the setting is turned on for an event that already has sign-ups, Skjera SHALL send every one of them.

**Test**

- **Given** «AC-7: Not yet a sales event», with two guests signed up
- **When** you tick **Sales event (send to HubSpot)** and publish
- **Then** HubSpot gets the Marketing Event and both guests registered on it, the earliest sign-up first

**Automated:** `packages/documents/test/notices/HubSpotSync.test.ts`

## AC-8: The guest form asks for a job title

WHERE an event is a sales event, the guest form SHALL have an optional field for job title.

**Test**

- **Given** «AC-1 to AC-9: Sales event» in a private window
- **When** you look at the guest form
- **Then** it has an optional **Your job title** field, named `jobtitle`, and an event that is not a sales event has none

**Automated:** `packages/app/test/signupForm.test.ts`, `packages/documents/test/Model.test.ts`

## AC-9: HubSpot's collected forms leave the form alone

WHERE an event is a sales event, the guest form SHALL NOT be read by HubSpot's collected forms.

**Test**

- **Given** a HubSpot account id set too, and collected forms on in the portal
- **When** a guest signs up to a sales event and another to an event that is not one
- **Then** under collected forms in HubSpot only the second sign-up is found

**Automated:** `packages/app/test/signupForm.test.ts` (that the form carries `data-hs-do-not-collect="true"`)

## AC-10: A failing call is tried again

IF a call to HubSpot fails, THEN Skjera SHALL try it again later, and keep the order of a person's sign-up and cancellation.

**Automated only:** HubSpot can't reasonably be made to fail by hand, nor its answers slowed. `packages/documents/test/notices/HubSpotSync.test.ts`, `packages/hubspot/test/HubSpot.test.ts`

## AC-11: Without the token, nothing is sent

IF `HUBSPOT_ACCESS_TOKEN` is not set, THEN Skjera SHALL send nothing to HubSpot, offer no setting, and warn at start.

**Test**

- **Given** no token
- **When** you start `pnpm dev` and open the studio for an event open to guests
- **Then** the log says that nothing is sent to HubSpot, and there is no **Sales event (send to HubSpot)** checkbox

**Automated:** `packages/documents/test/notices/HubSpotSync.test.ts`, `packages/app/test/salesEvent.test.ts`
