# ACC-04: The studio and account page need login

Anyone can read the site. The studio and **Account settings** are only for those logged in.

## AC-1: No Studio link for visitors

WHILE a visitor is not logged in, the header SHALL not show the **Studio** link.

**Test**

- **Given** a private window, not logged in
- **When** you open http://localhost:5173
- **Then** the header has **Log in**, and no **Studio**

**Automated:** `packages/app/e2e/specs/site/site.spec.ts`

## AC-2: The studio sends visitors to log in

WHEN a visitor who is not logged in opens a page of the studio, Skjera SHALL send them to log in, and back to that page after.

**Test**

- **Given** a private window, not logged in
- **When** you open http://localhost:5173/studio/teams
- **Then** Dex's login page shows
- **When** you log in as alice
- **Then** you are at `/studio/teams`

**Automated:** `packages/app/e2e/specs/site/site.spec.ts`, which checks the way to the login page, not the way back

## AC-3: Account settings send visitors to log in

WHEN a visitor who is not logged in opens **Account settings** at `/account`, Skjera SHALL send them to log in, and back to that page after.

**Test**

- **Given** a private window, not logged in
- **When** you open http://localhost:5173/account
- **Then** Dex's login page shows
- **When** you log in as bob
- **Then** you are on **Account settings**, with bob's name and email

**Automated:** `packages/app/e2e/specs/tooling/login.spec.ts`

## AC-4: The Studio link, marked where you are

WHILE a user is logged in, the header SHALL show the **Studio** link, marked as the current page inside the studio and not on the site.

**Test**

- **Given** alice logged in
- **When** you open the studio
- **Then** **Studio** in the header is marked as the page you are on
- **When** you click the site's name, then **Account settings** in the account menu
- **Then** **Studio** is there on both pages, and not marked

**Automated:** `packages/app/e2e/specs/site/site.spec.ts`
