# OPS-08: The /playground page

`/playground` is a page for developers: two copies of a draft, kept in the browser, syncing with each other with no server and no login. It shows how the studio's drafts merge.

**Set-up:** `pnpm dev` running.

## AC-1: Two copies, without a login

Skjera SHALL serve a page at `/playground` with two copies of a draft, «Replica 1» and «Replica 2», each with a **Title** and a **Body**, to anyone, without a login.

**Test**

- **Given** a private window, not logged in
- **When** you open http://localhost:5173/playground
- **Then** it shows «Replica 1» and «Replica 2», each with **Title**, **Body** and what it holds, and **Replicas connected** ticked

**Automated:** `packages/app/e2e/specs/playground.spec.ts`

## AC-2: Edits show in the other copy

WHILE **Replicas connected** is ticked, what is typed in one copy SHALL show in the other as it is typed.

**Test**

- **Given** the playground open
- **When** you type «Hello there» in Replica 1's **Title**
- **Then** Replica 2's **Title** shows «Hello there», and you can go on typing in either

**Automated:** `packages/app/e2e/specs/playground.spec.ts`

## AC-3: Edits made apart are merged

WHEN the copies are connected again after being edited apart, Skjera SHALL merge both copies' edits, the same in each.

**Test**

- **Given** «Hello» in both copies' **Body**
- **When** you untick **Replicas connected**, add « left» at the end of Replica 1's **Body** and «right » at the start of Replica 2's
- **And** you tick **Replicas connected** again
- **Then** both **Body** fields say «right Hello left», and both copies hold the same

**Automated:** `packages/app/e2e/specs/playground.spec.ts`

## AC-4: Plain text, line breaks kept

The draft SHALL hold the title on one line and the body with its line breaks, as plain text.

**Test**

- **Given** the playground open
- **When** you type «One», press Enter and type « line» in Replica 1's **Title**
- **And** you type «First», press Enter and type «Second» in its **Body**
- **Then** what Replica 2 holds reads `{"title":"One line","body":"First\nSecond"}`

**Automated:** `packages/app/e2e/specs/playground.spec.ts`
