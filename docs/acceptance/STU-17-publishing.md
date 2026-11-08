# STU-17: Publishing

An event is written in the studio and reaches the site only when an organiser clicks **Publish**. Edits made after that stay in the studio until it is published again or discarded ([STU-23](STU-23-discarding-changes.md)).

Publishing also needs a place, as [STU-11](STU-11-place.md) AC-2 says. A published event is taken off the site by unpublishing it ([STU-20](STU-20-unpublishing.md)), deleting it ([STU-19](STU-19-deleting.md)) or making it members only ([STU-12](STU-12-visibility.md)).

**Events:** in team «STU-17: Publishing»:

- «AC-1 to AC-5: Published», public, with a time and a place, not yet published.
- A new event with nothing filled in, not even its title. AC-2 has you title it «AC-2 and AC-3: Refused».
- «AC-6: Unsaved», public, published.

## AC-1: Publish puts the event on the site

WHEN an organiser clicks **Publish**, Skjera SHALL put the event on the site as it is in the studio, and the studio SHALL say when it was published.

**Test**

- **Given** «AC-1 to AC-5: Published» open in the studio, with the footer saying «Not published»
- **When** you click **Publish**
- **Then** the footer says «Published just now» and **View on site**, the button reads **Published** and can't be clicked, and the event is listed «Published» in the team
- **When** you click **View on site**
- **Then** the event page shows it as written

**Automated:** `packages/app/e2e/specs/site/site.spec.ts`, `packages/app/e2e/specs/studio/teams.spec.ts`, `packages/documents/test/events/publishing.test.ts`

## AC-2: A title and times are needed

IF an event has no title, start time or end time, THEN Skjera SHALL refuse to publish it, naming everything that is missing.

**Test**

- **Given** the new event, with nothing filled in
- **When** you click **Publish**
- **Then** it says «Add a title, a start time, an end time and a place before publishing», and the footer still says «Not published»
- **When** you write the title «AC-2 and AC-3: Refused» and click **Publish** again
- **Then** the title is no longer named

**Automated:** `packages/app/e2e/specs/studio/collaboration.spec.ts`, `packages/documents/test/events/publishing.test.ts`, `packages/documents/test/api/Problems.test.ts`

## AC-3: The times must fit together

IF an event ends before it starts, has a sign-up deadline after it starts, or a food deadline after sign-up closes, THEN Skjera SHALL refuse to publish it and say which.

**Test**

- **Given** «AC-2 and AC-3: Refused» with a title, a place, and a start and end
- **When** you set the end before the start and click **Publish**
- **Then** it says «The event has to end after it starts»
- **When** you set the end right again, set a sign-up deadline after the start, and click **Publish**
- **Then** it says «The sign-up deadline can't be after the event starts»
- **When** you set the deadline before the start, tick **Food is served**, set the food deadline after the sign-up deadline, and click **Publish**
- **Then** it says «The food deadline can't be after sign-up closes»

**Automated:** `packages/app/e2e/specs/studio/collaboration.spec.ts`, `packages/documents/test/events/publishing.test.ts`

## AC-4: Edits stay off the site until published

WHILE a published event has edits not yet published, the site SHALL show the event as it was last published, and the studio SHALL mark it as changed.

**Test**

- **Given** «AC-1 to AC-5: Published», published and open on the site
- **When** you change its title in the studio, without publishing, and reload the site
- **Then** the site shows the old title, the event is listed «Changed» in the team, and **Publish** can be clicked again
- **When** you click **Publish** and reload the site
- **Then** the site shows the new title, and the list says «Published»

**Automated:** `packages/app/e2e/specs/site/site.spec.ts`, `packages/app/e2e/specs/studio/teams.spec.ts`, `packages/documents/test/events/publishing.test.ts`

## AC-5: Others see it published

WHEN an event is published, the studio SHALL show it as published to other organisers with it open, without reloading.

**Test**

- **Given** «AC-1 to AC-5: Published» with a change not yet published, open in the studio as alice and as bob
- **When** bob clicks **Publish**
- **Then** alice's footer and team list say it is published, without reloading

**Automated:** `packages/app/e2e/specs/studio/teams.spec.ts`

## AC-6: Unsaved edits are not published

IF the server has not received every edit within 10 seconds of **Publish** being clicked, THEN Skjera SHALL refuse to publish and say the edits aren't saved yet.

**Test**

- **Given** «AC-6: Unsaved» open in the studio
- **When** you stop `pnpm dev`, change the title, and click **Publish**
- **Then** after about 10 seconds it says «Couldn't publish: your edits haven't been saved yet»
- **When** you start `pnpm dev` again and reload the site
- **Then** the site still shows the old title

**Automated:** `packages/app/test/studio/savedVersion.test.ts`, which checks the wait, not that **Publish** uses it

## AC-7: What was seen is what is published

IF someone edits an event while an organiser clicks **Publish**, THEN Skjera SHALL publish the version that organiser saw, and keep the later edits for the next publishing.

**Automated only:** the edits would have to arrive in the moment between the click and the server. `packages/documents/test/events/publishing.test.ts`
