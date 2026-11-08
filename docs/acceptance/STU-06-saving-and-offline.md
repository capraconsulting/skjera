# STU-06: Saving, and editing offline

Edits are saved as they are made, with no save button. Edits made without a connection are kept, and saved once it is back.

**Events:** in team «STU-06: Saving, and editing offline», one event per criterion. Bob uses Chrome, so he can go offline from its developer tools: **Network**, then **Offline**.

## AC-1: Saved as you write

WHILE an organiser edits an event, the editor's footer SHALL show «Saving…» until the server has every edit, and «Saved» once it has.

**Test**

- **Given** «AC-1: Saved» open in the studio
- **When** you type in **Body**, and then open the event in another browser
- **Then** the footer shows «Saving…» and then «Saved», there is no save button, and the other browser shows the text

**Automated:** `packages/app/e2e/specs/studio/typing.spec.ts`

## AC-2: Edits made offline are kept

WHILE an organiser has no connection, the editor SHALL keep their edits and show «Saving…».

**Test**

- **Given** «AC-2 to AC-3: Offline» open as alice, and as bob in Chrome
- **When** bob goes offline and adds a sentence to **Body**
- **Then** bob's footer says «Saving…» and his text stays, while alice doesn't get it

**Automated:** `packages/app/e2e/specs/studio/typing.spec.ts`

## AC-3: Merged once back online

WHEN an organiser's connection is back, Skjera SHALL save the edits they made offline and merge them with what others wrote meanwhile, also after the page is reloaded.

**Test**

- **Given** bob offline with his sentence, as in AC-2
- **When** alice adds another sentence at the start of **Body**
- **And** bob goes online again and reloads the page
- **Then** both see both sentences, and bob's footer says «Saved»

**Automated:** `packages/app/e2e/specs/studio/typing.spec.ts`

## AC-4: Edits sent twice are kept once

IF an editor sends the same edits again, as after a lost connection, THEN Skjera SHALL keep them once, and SHALL refuse edits that build on ones it hasn't received.

**Automated only:** the studio resends edits on its own, out of sight. `packages/documents/test/events/drafts.test.ts`
