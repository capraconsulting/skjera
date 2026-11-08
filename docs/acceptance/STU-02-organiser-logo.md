# STU-02: The team as organiser, with its logo

Each event shows its team as the organiser: the team's logo, or its name when it has none.

**Events:** three teams, each with one public event, and an event bob signs up to.

- «STU-02: Logo for light and dark», with a logo for each theme.
- «STU-02: Light logo only», with a logo for the light theme only.
- «STU-02: No logo», with none.

Use logos that are easy to tell apart, such as a word in a colour.

## AC-1: Logos are set in the studio

The studio SHALL let a team be given a logo for the light theme and a logo for the dark theme, each changeable and removable.

**Test**

- **Given** a team in the studio
- **When** you open the team's **⋯** menu, **Logo…**, and choose an image for **Light theme** and for **Dark theme**
- **And** you **Replace image** on one and **Remove image** on the other
- **Then** each change shows at once in the dialog

**Automated:** `packages/app/e2e/specs/studio/teams.spec.ts`, `packages/documents/test/Teams.test.ts`, `packages/documents/test/Model.test.ts`

## AC-2: The front page shows the organiser

The site's list of events SHALL show each event's organiser: its team's logo, or its team's name when the team has no logo.

**Test**

- **Given** the three teams' events, published
- **When** you open the front page
- **Then** the teams with a logo show it, and the other shows its name, «STU-02: No logo»

**Automated:** `packages/app/e2e/specs/site/siteOrganizers.spec.ts`, `packages/documents/test/server/Sync.test.ts`

## AC-3: The event page shows the organiser

The event page SHALL show the event's organiser in the same way.

**Test**

- **Given** the same events
- **When** you open each of them
- **Then** the organiser shows as on the front page

**Automated:** `packages/app/e2e/specs/site/siteOrganizers.spec.ts`, `packages/documents/test/server/Sync.test.ts`

## AC-4: The dark theme shows the dark logo

WHILE the site is shown in the dark theme, Skjera SHALL show a team's dark-theme logo, and its light-theme logo when it has no dark one.

**Test**

- **Given** bob with **Theme** set to **Dark** under **Account settings**
- **When** he opens the front page
- **Then** «STU-02: Logo for light and dark» shows its dark logo, and «STU-02: Light logo only» its light one

**Automated:** `packages/app/e2e/specs/site/siteOrganizers.spec.ts`, `packages/documents/test/Model.test.ts`

## AC-5: Invitations name the team as organiser

Every calendar invitation Skjera sends for an event SHALL name the event's team as its organiser.

**Test**

- **Given** one of the events
- **When** bob signs up, and you open the invitation in his email in Mailpit
- **Then** `ORGANIZER` has the team's name

**Automated:** `packages/app/e2e/specs/attendance/emails.spec.ts`, `packages/documents/test/notices/organizer.test.tsx`

## AC-6: A new name or logo shows everywhere at once

WHEN a team's name or logo changes, the site SHALL show the change for every event of that team, published before or after.

**Test**

- **Given** «STU-02: No logo» with its published event
- **When** you rename the team, or give it a logo, without publishing anything
- **Then** its event on the site shows the new name or logo

**Automated:** `packages/app/e2e/specs/site/siteOrganizers.spec.ts`, `packages/documents/test/server/Sync.test.ts`
