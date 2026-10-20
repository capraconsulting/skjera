# STU-04: Editing an event together, live

Several organisers can have the same event open and edit it at once. Each sees the others' edits as they are made.

**Events:** in team «STU-04: Editing an event together, live», one event per criterion, open in the studio as alice and as bob in his browser.

## AC-1: Edits show for the others at once

WHILE two organisers have the same event open, the studio SHALL show each of them what the other writes, without reloading.

**Test**

- **Given** «AC-1: Live» open as alice and as bob
- **When** alice writes in **Title**, and bob writes in **Body**
- **Then** each sees the other's text appear as it is typed

**Automated:** `packages/app/e2e/specs/collaboration.spec.ts`, `packages/documents/test/events/drafts.test.ts`, `packages/documents/test/events/DraftSync.test.ts`

## AC-2: Typing at once, nothing lost

WHEN two organisers type in the same text at the same time, Skjera SHALL keep every keystroke of both, with each person's text in one piece.

**Test**

- **Given** «AC-2: At once» open as alice and as bob, with «Hello» in **Body**
- **When** alice types a sentence at the start of the body while bob types another at its end, both at the same time
- **Then** both see the same text, with both sentences whole and no letter lost or doubled

**Automated:** `packages/app/e2e/specs/typing.spec.ts`, `packages/app/e2e/specs/collaboration.spec.ts`

## AC-3: Other fields too

WHEN an organiser changes a time, a checkbox or another field, the studio SHALL show the change to the others with the event open.

**Test**

- **Given** «AC-3: Fields» open as alice and as bob
- **When** alice picks a start date and time, and ticks **Public event**
- **Then** bob sees the same start, the end two hours later, and **Public event** ticked

**Automated:** `packages/app/e2e/specs/collaboration.spec.ts`

## AC-4: Edits that don't fit an event are refused

IF an editor sends a change that doesn't fit an event, such as a field events don't have, THEN Skjera SHALL refuse it, keep it off the saved event, and tell that editor «Couldn't save your changes: …».

**Automated only:** the studio can't make such a change. `packages/documents/test/events/drafts.test.ts`, `packages/documents/test/events/DraftSync.test.ts`
