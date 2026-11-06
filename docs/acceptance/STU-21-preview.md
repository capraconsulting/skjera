# STU-21: Previewing an event

An organiser opens **Preview** («Forhåndsvisning» in Bokmål, «Førehandsvising» in Nynorsk) on an event in the studio to see its page as it will look once published, with the draft as it is now. The preview is the site's own event page, opened in a new tab at `/events/<id>/preview`, under the site's header. It follows the draft as the studio saves it, so it changes while the organiser types.

**Readings:**

- The button sits in the editor's footer, beside the other actions, for every event, published or not.
- The preview shows the draft as publishing it now would make it. Those signed up are the published event's; a draft never published has none. A blank place shows no place line, since publishing refuses an event without one.
- The notice is fixed to the bottom of the window and stays in view while the page scrolls. It says the same for an event never published and for a published one with changes, and links to the published page only while there is one.
- A draft never published is shown once it has a start and an end. Until then the preview shows the notice and a line saying the page is shown once the event has both.
- The sign-up box is shown as the published page shows it to the organiser, but nothing in it can be clicked, typed in or focused.
- The preview loads no HubSpot, as the studio loads none (EXT-06).

**Events:** in team «STU-21: Preview», public events open to guests:

- «AC-1 to AC-7: Published», published, starting in a week.
- «AC-1 to AC-5: Never published», a draft with times and a place.
- «AC-5: No times», a draft with a title and its test steps, and no times.

## AC-1: A button opens the preview

The studio SHALL show a button **Preview** for each event that opens a preview of its page in a new tab.

**Test**

- **Given** «AC-1 to AC-7: Published» open in the studio
- **When** you click **Preview**
- **Then** a new tab opens at `/events/<id>/preview` showing the event
- **When** you open «AC-1 to AC-5: Never published» and click **Preview**
- **Then** its preview opens in a new tab too

**Automated:** `packages/app/e2e/specs/preview.spec.ts`

## AC-2: The site's own page, with the draft as it is

WHEN an organiser opens the preview, Skjera SHALL show the event's page as it will look with the current draft, using the same page as the site.

**Test**

- **Given** «AC-1 to AC-7: Published» open in the studio, with a word added to its title and not published
- **When** you open its preview
- **Then** the preview shows the new title, and the event's page on the site still shows the old one
- **When** you publish the event and compare the preview with the site's page
- **Then** the two look the same: spacing, cover and the organiser's logo in both themes

**Automated:** `packages/documents/test/events/preview.test.ts`, `packages/app/e2e/specs/preview.spec.ts`

## AC-3: It follows the draft

WHEN the draft changes while the preview is open, the preview SHALL show the change without a reload.

**Test**

- **Given** the preview of «AC-1 to AC-7: Published» open in one tab and the event open in the studio in another
- **When** you change the title in the studio
- **Then** the preview shows the new title without being reloaded

**Automated:** `packages/app/e2e/specs/preview.spec.ts`

## AC-4: A fixed notice

WHILE a preview is shown, the page SHALL say in a fixed notice that it is a preview and not published, with a link to the published page when there is one.

**Test**

- **Given** the preview of «AC-1 to AC-7: Published»
- **Then** a notice says «Preview – this isn't published.» with a link to the published page
- **When** you scroll to the bottom of the page
- **Then** the notice is still in view
- **When** you open the preview of «AC-1 to AC-5: Never published»
- **Then** the notice says the same, with no link

**Automated:** `packages/app/e2e/specs/preview.spec.ts`

## AC-5: An event never published

WHEN an organiser opens the preview of an event that has never been published, Skjera SHALL show it.

**Test**

- **Given** «AC-1 to AC-5: Never published» open in the studio
- **When** you open its preview
- **Then** the event's title is the page's heading
- **When** you open the preview of «AC-5: No times»
- **Then** it says «The page is shown once the event has a start and an end.»
- **When** you pick a start and an end in the studio
- **Then** the page is shown, without a reload

**Automated:** `packages/documents/test/events/preview.test.ts`, `packages/app/e2e/specs/preview.spec.ts`

## AC-6: Only those logged in

IF someone not logged in opens the address of a preview, THEN Skjera SHALL say «Dette arrangementet finnes ikke, eller er ikke publisert.».

**Test**

- **Given** the address of a preview, in a private window not logged in
- **When** you open it
- **Then** the page says «Dette arrangementet finnes ikke, eller er ikke publisert.» and shows nothing of the draft
- **When** you open the address of a preview of an id with no draft, logged in
- **Then** it says the same
- **When** you delete the event in the studio while its preview is open
- **Then** the preview says the same

**Automated:** `packages/app/e2e/specs/preview.spec.ts`

## AC-7: No sign-up on the preview

WHILE a preview is shown, the page SHALL NOT let anyone sign up, cancel or change an answer.

**Test**

- **Given** the preview of «AC-1 to AC-7: Published»
- **Then** the sign-up box is shown
- **When** you click it or tab to it
- **Then** nothing happens, and nobody is added to the event

**Automated:** `packages/app/e2e/specs/preview.spec.ts`

## AC-8: Described here

The feature files in `docs/acceptance` SHALL describe the preview.

**Test**

- **Given** this file
- **Then** it describes the preview, the README lists it as STU-21, and EXT-06 names the preview among the pages without HubSpot
- **And** every team and event this file's **Events:** names is in the test data

**Automated:** `packages/server/test/testdata.test.ts`
