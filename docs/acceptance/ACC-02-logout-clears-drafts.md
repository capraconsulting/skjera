# ACC-02: Logging out removes local copies of drafts

The studio keeps a copy of each draft it opens in the browser, so no edit is lost while offline. Logging out deletes those copies, so they don't stay behind on a shared computer.

**Events:** in team «ACC-02: Logging out removes local copies of drafts», one event, «AC-1 to AC-2: Kept on the server», with a line of text in its **Body**.

The local copies are seen in the browser's developer tools: **Application**, **IndexedDB**, the database whose name starts with `skjera `, and its store `documents`.

## AC-1: Logging out deletes the local copies

WHEN a user logs out, Skjera SHALL delete the local copies of the drafts they opened in that browser.

**Test**

- **Given** alice logged into the studio, with «AC-1 to AC-2: Kept on the server» open and **Saved** showing
- **And** the `documents` store in the developer tools has entries
- **When** alice clicks **Log out** in the account menu
- **Then** the `documents` store has no entries

**Automated:** `packages/app/e2e/specs/studio/typing.spec.ts`

## AC-2: The drafts are still on the server

WHEN a user logs in again after logging out, the studio SHALL show their drafts as they were saved, from the server.

**Test**

- **Given** alice logged out, as in AC-1
- **When** she logs in again and opens «AC-1 to AC-2: Kept on the server»
- **Then** its **Body** has the line of text written before

**Automated:** `packages/app/e2e/specs/studio/typing.spec.ts`

## AC-3: A local copy that cannot be deleted

IF the local copies cannot be deleted, THEN Skjera SHALL tell the user before logout finishes that the copies may remain on the computer.

**Automated only:** a browser storage failure cannot be brought about through the account menu. `packages/app/e2e/specs/studio/typing.spec.ts`
