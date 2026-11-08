# STU-05: Who else has the event open

The editor shows who else has the same event open, and where they are writing.

**Events:** in team «STU-05: Who else has the event open», one event, «AC-1 to AC-5: Presence», with a title. Alice has it open in the studio; bob opens it in his browser.

## AC-1: An avatar for each of the others

WHILE others have the same event open, the editor SHALL show an avatar for each of them, and their name when the avatar is hovered.

**Test**

- **Given** the event open as alice
- **When** bob opens it, and alice hovers the avatar over her editor
- **Then** alice sees one avatar, and hovering it shows «bob»; bob sees one for «alice»

**Automated:** `packages/app/e2e/specs/studio/presence.spec.ts`, `packages/documents/test/events/DraftSync.test.ts`

## AC-2: One avatar per person

The editor SHALL show one avatar for a person however many tabs they have the event open in.

**Test**

- **Given** the event open as alice
- **When** bob opens it in two tabs
- **Then** alice still sees one avatar for «bob»

**Automated:** `packages/app/e2e/specs/studio/presence.spec.ts`

## AC-3: Where the others write

WHILE another person is writing in a text field of the event, the editor SHALL show their cursor there, marked with their name.

**Test**

- **Given** the event open as alice and as bob
- **When** bob types at the end of **Title**
- **Then** alice sees a cursor marked «bob» where he types

**Automated:** `packages/app/e2e/specs/studio/presence.spec.ts`

## AC-4: The cursor stays in another window

WHEN a person switches to another window, the editor SHALL keep showing their cursor until they move to something else on the page.

**Test**

- **Given** bob's cursor showing in alice's **Title**, as in AC-3
- **When** bob switches to another app
- **And** he comes back, and clicks into **Place**
- **Then** alice still sees his cursor while he is in the other app, and it leaves **Title** once he clicks into **Place**

**Automated:** `packages/app/e2e/specs/studio/presence.spec.ts`

## AC-5: Leaving the event

WHEN a person leaves the event, the editor SHALL take away their avatar and cursor.

**Test**

- **Given** the event open as alice and as bob, with bob's cursor showing in **Title**
- **When** bob clicks the team in the **Teams** column
- **Then** his avatar and cursor go from alice's editor

**Automated:** `packages/app/e2e/specs/studio/presence.spec.ts`

## AC-6: Shown under the name they logged in with

Skjera SHALL show each person present under the name they logged in with, and SHALL not pass on presence an editor claims for someone else.

**Automated only:** the studio can't claim to be someone else. `packages/documents/test/events/DraftSync.test.ts`
