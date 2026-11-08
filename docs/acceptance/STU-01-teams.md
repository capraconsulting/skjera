# STU-01: Teams

Events are made in teams. Every organiser sees every team, and can create, rename and delete them.

**Events:** a team «STU-01: Teams» with one event, «AC-5: Keeps its team». Bob is logged in to the studio in his own browser.

## AC-1: A new team, seen by everyone

The studio SHALL let an organiser create a team, and SHALL show every team to everyone logged in.

**Test**

- **Given** alice in the studio, and bob in the studio in his browser
- **When** alice opens **Team list options** (**⋯** above the teams), clicks **New team**, writes «STU-01: Created» and clicks **Create team**
- **Then** the team opens for alice, and shows in bob's **Teams** column too

**Automated:** `packages/app/e2e/specs/studio/teams.spec.ts`, `packages/documents/test/Teams.test.ts`

## AC-2: Team names are unique, ignoring case

IF a team is given a name another team has, in any case, THEN Skjera SHALL refuse it and keep the dialog open with the name as written.

**Test**

- **Given** the team «STU-01: Teams»
- **When** you create a new team named «stu-01: TEAMS»
- **Then** the dialog stays open with «There is already a team called stu-01: TEAMS» and the name kept, and no second team is listed

**Automated:** `packages/app/e2e/specs/studio/teams.spec.ts`, `packages/documents/test/Teams.test.ts`

## AC-3: A name of 1 to 100 characters

IF a team name is blank or longer than 100 characters, THEN Skjera SHALL refuse it.

**Test**

- **Given** the **New team** dialog
- **When** you write only spaces and click **Create team**
- **And** you try to write more than 100 characters
- **Then** the spaces are refused with «A team name needs 1 to 100 characters», and the field takes no more than 100 characters

**Automated:** `packages/documents/test/Teams.test.ts`

## AC-4: Renaming a team

The studio SHALL let an organiser rename a team, and IF the new name is taken, THEN Skjera SHALL refuse it and keep the old name.

**Test**

- **Given** the team «STU-01: Teams», and the team from AC-1
- **When** you open the team's **⋯** menu, **Rename team…**, and give it the name of the team from AC-1
- **And** you then give it a free name, «STU-01: Renamed», and click **Rename team**
- **Then** the first is refused with «There is already a team called …» and the old name stays; the second renames it

**Automated:** `packages/app/e2e/specs/studio/teams.spec.ts`, `packages/documents/test/Teams.test.ts`

## AC-5: Only empty teams can be deleted

IF a team has events, THEN the studio SHALL not let it be deleted, and SHALL say why.

**Test**

- **Given** the team with «AC-5: Keeps its team», and the empty team from AC-1
- **When** you open each team's **⋯** menu
- **Then** **Delete team** is disabled for the team with an event, with «Only teams without events can be deleted.», and deletes the empty team

**Automated:** `packages/app/e2e/specs/studio/teams.spec.ts`, `packages/documents/test/Teams.test.ts`

## AC-6: The team list follows others

WHEN someone else creates, renames or deletes a team, the studio SHALL show it in the open team list without reloading.

**Test**

- **Given** alice and bob both in the studio
- **When** bob creates a team, renames it, and deletes it
- **Then** alice's **Teams** column follows each change without reloading

**Automated:** `packages/app/e2e/specs/studio/teams.spec.ts`
