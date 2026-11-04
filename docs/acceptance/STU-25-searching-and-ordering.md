# STU-25: Searching and ordering events

An organiser who has many events can find one by searching a team's list in the studio, or every team at once, and can choose whether the list is ordered by when each event was last edited, created, or held.

**Events:** in team «STU-25: Searching and ordering», four drafts made in this order:

- «AC-2: Sommerfest», 60 days ahead.
- «AC-1: Julebord», tagged «Sosialt», 30 days ahead.
- «AC-1: Fagkveld», tagged «Fag», 10 days ahead.
- «AC-2: No date», with a title only.

In team «STU-25: Another team», the draft «AC-3: Julebord in another team».

The test data makes and edits each event at once, so «Sist endret» and «Opprettet» list them alike until one is edited. Before you test the order, add a tag to «AC-1: Julebord».

## AC-1: Search a team's list

WHEN the organiser types in «Søk» on a team's list, the studio SHALL show only that team's events whose title or tags contain the text, ignoring case.

**Test**

- **Given** team «STU-25: Searching and ordering» open in the studio
- **When** you type «JULE» in «Søk»
- **Then** «AC-1: Julebord» is listed, and «AC-1: Fagkveld» is not
- **When** you type «sosi»
- **Then** «AC-1: Julebord» is listed, found by its tag, though it was never published
- **When** you empty the field, or type only spaces
- **Then** every event of the team is listed
- **When** you open «AC-1: Julebord» while «JULE» is typed
- **Then** the search and the narrowed list stay
- **When** you pick another team and come back
- **Then** the field is empty and the whole list is shown

**Automated:** `packages/app/test/eventList.test.ts`, `packages/documents/test/events/drafts.test.ts`, `packages/documents/test/server/migrations.test.ts`, `packages/app/e2e/specs/teams.spec.ts`

## AC-2: Choose the order of a team's list

The studio SHALL let the organiser order a team's list by «Sist endret», «Opprettet» or «Dato for arrangementet», newest first, with «Sist endret» as the default.

**Test**

- **Given** «AC-1: Julebord» edited since the events were made, and the studio opened in a browser that has not chosen an order
- **Then** the order choice says «Sist endret» and «AC-1: Julebord» is first
- **When** you choose «Opprettet»
- **Then** «AC-2: No date», the event made last, is first
- **When** you choose «Dato for arrangementet»
- **Then** «AC-2: Sommerfest», the latest start, is first, and «AC-2: No date» is last

**Automated:** `packages/app/test/eventList.test.ts`, `packages/app/e2e/specs/teams.spec.ts`

## AC-3: Search every team

WHEN the organiser searches on the page that lists the teams, the studio SHALL show matching events from every team, each with its team.

**Test**

- **Given** the studio open on the page that lists the teams
- **When** you type «julebord» in «Søk i alle team»
- **Then** «AC-1: Julebord» and «AC-3: Julebord in another team» are listed in place of the teams, each with its team's name, in the order chosen
- **When** you click «AC-3: Julebord in another team»
- **Then** it opens in the editor, and its own team is shown in the events column
- **When** you empty the field
- **Then** the teams are listed again

**Automated:** `packages/app/e2e/specs/teams.spec.ts`

## AC-4: Nothing found

IF a search matches no event, THEN the studio SHALL say that nothing was found.

**Test**

- **When** you type «finnes ikke» in «Søk» on a team's list
- **Then** the list says «Fant ingen arrangementer.»
- **When** you type «finnes ikke» in «Søk i alle team»
- **Then** the column says «Fant ingen arrangementer.»

**Automated:** `packages/app/test/eventList.test.ts`, `packages/app/e2e/specs/teams.spec.ts`

## AC-5: The order is kept

WHILE the organiser moves around the studio, the studio SHALL keep the order they chose for the lists.

**Test**

- **Given** «Opprettet» chosen
- **When** you pick another team, open an event, or reload the studio
- **Then** the order choice still says «Opprettet» and the list is ordered so
- **And** the results of «Søk i alle team» are in the same order

**Automated:** `packages/app/test/eventList.test.ts`, `packages/app/e2e/specs/teams.spec.ts`

## AC-6: The lists follow others live

WHILE a search or an order is in use, the list SHALL keep following other people's edits live.

**Test**

- **Given** alice with a word typed both in «Søk» on a team's list and in «Søk i alle team», and «Opprettet» chosen
- **When** bob makes an event in the team and titles it with the word
- **Then** alice's team list shows it first, and her results across teams list it, without reloading

**Automated:** `packages/app/e2e/specs/teams.spec.ts`

## AC-7: This page

The acceptance docs SHALL describe the search and the order, with a manual test for each criterion and the automated tests that check it.

**Automated only:** no test reads the acceptance docs. This page is the check.
