# STU-03: Events in a team

Each event belongs to a team. The team's events are listed beside the teams, with their date and whether they are published.

**Events:** in team «STU-03: Events in a team», made as the criteria say. Also an empty team, «STU-03: No events». Bob is logged in to the studio in his own browser.

## AC-1: A new event in the team picked

WHEN an organiser clicks **New event**, the studio SHALL create an event in the team picked, open it, and list it under that team.

**Test**

- **Given** the team «STU-03: Events in a team» picked in the studio
- **When** you click **New event** and write the title «AC-1: New event»
- **Then** the event opens in the editor, and the **Events** column lists it with its title

**Automated:** `packages/app/e2e/specs/teams.spec.ts`, `packages/documents/test/Teams.test.ts`

## AC-2: Untitled and undated events

IF an event has no title or no start, THEN the events list SHALL show «Untitled» or «No date» in their place.

**Test**

- **Given** the team picked
- **When** you click **New event** and write nothing
- **And** you then pick a start date
- **Then** the list shows «Untitled» and «No date»; with a start, the date shows instead, such as «Nov 15, 2026»

**Automated:** none

## AC-3: Whether each event is published

The events list SHALL mark each event as «Draft» before it is published, «Published» when it is published as it is, and «Changed» when it has edits since it was published.

**Test**

- **Given** «AC-3: Status», with a title, a time and a place, not published
- **When** you look at the list, click **Publish**, and then change its title
- **Then** it says «Draft», then «Published», then «Changed»

**Automated:** `packages/app/e2e/specs/teams.spec.ts`, `packages/app/e2e/specs/collaboration.spec.ts`

## AC-4: The list follows others

WHEN someone else adds, renames, publishes or deletes an event in a team, the studio SHALL show it in the open events list without reloading.

**Test**

- **Given** alice with the team open, and bob with the same team in his browser
- **When** bob clicks **New event**, writes «AC-4: Added by bob», gives it a time and a place, publishes it, and deletes it
- **Then** alice's list shows each change without reloading

**Automated:** `packages/app/e2e/specs/teams.spec.ts`, `packages/documents/test/events/drafts.test.ts`

## AC-5: Each team shows its own events

WHEN an organiser picks another team, the studio SHALL show that team's events only, and «No events yet.» when it has none.

**Test**

- **Given** the two teams
- **When** you click «STU-03: No events», noting its id from the address, then «STU-03: Events in a team»
- **Then** the first says «No events yet.», and the second lists its events again, without the page reloading

**Automated:** `packages/app/e2e/specs/teams.spec.ts`

## AC-6: A link with the wrong team

WHEN an event is opened by a link that names another team, the studio SHALL open it under its own team.

**Test**

- **Given** «AC-1: New event» open, and the address in the browser
- **When** you replace the team's id in the address with the id of «STU-03: No events» noted in AC-5, and open it
- **Then** the event opens, and the address and the columns show «STU-03: Events in a team»

**Automated:** `packages/app/e2e/specs/teams.spec.ts`

## AC-7: A team that is gone

IF a team that no longer exists is opened, THEN the studio SHALL say «This team doesn't exist anymore.»

**Test**

- **Given** «STU-03: No events» open, and its address copied
- **When** you delete the team, and open the copied address
- **Then** the studio says «This team doesn't exist anymore.»

**Automated:** none
