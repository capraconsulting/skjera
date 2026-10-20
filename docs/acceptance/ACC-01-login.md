# ACC-01: Logging in and out

Members and organisers log in with the company's login provider, Dex in development, and log out from the account menu. Visitors read the site without logging in.

## AC-1: Log in from the site, into the studio

WHEN a visitor clicks **Log in** in the site's header and logs in at the login provider, Skjera SHALL take them to the studio, logged in.

**Test**

- **Given** http://localhost:5173 open in a private window, not logged in
- **When** you click **Log in**
- **And** you log in at Dex's page as `alice@example.com`, password `password`
- **Then** you land in the studio, at `/studio/teams`, with alice's account menu in the header

**Automated:** `packages/app/e2e/specs/site.spec.ts`, `packages/oauth/e2e/specs/login.spec.ts`, `packages/oauth/test/OAuthClient.test.ts`

## AC-2: A wrong password logs nobody in

IF the login provider refuses the password, THEN Skjera SHALL leave the visitor not logged in, at the provider's login page.

**Test**

- **Given** a private window at http://localhost:5173
- **When** you click **Log in** and log in as `bob@example.com` with the password `wrong`
- **Then** you stay at Dex's login page, and the site still shows **Log in**

**Automated:** `packages/oauth/e2e/specs/login.spec.ts`

## AC-3: Back to the page that asked for the login

WHEN a page that needs a login sends a visitor to log in, Skjera SHALL bring them back to that page after the login.

**Test**

- **Given** a private window, not logged in
- **When** you open http://localhost:5173/account and log in as bob
- **Then** you land on **Account settings**, not in the studio

**Automated:** `packages/oauth/e2e/specs/login.spec.ts`, against the login package's own server, `packages/oauth/test/returnTo.test.ts`

## AC-4: Never on to another site

IF the address to come back to after a login is on another site, THEN Skjera SHALL ignore it and take the user to the front page.

**Test**

- **Given** a private window, not logged in
- **When** you open http://localhost:5173/auth/login?returnTo=https://example.org/ and log in as bob
- **Then** you land on http://localhost:5173/, not on example.org

**Automated:** `packages/oauth/e2e/specs/login.spec.ts`, `packages/oauth/test/returnTo.test.ts`

## AC-5: A login is used once

IF the login provider's answer for a login arrives a second time, THEN Skjera SHALL refuse it, and log nobody in with it.

**Automated only:** the provider's answer passes through the browser in a moment, and can't reasonably be caught and sent again by hand. `packages/oauth/e2e/specs/login.spec.ts`, `packages/oauth/test/Sessions.test.ts`

## AC-6: Log out from the account menu

WHEN a logged-in user clicks **Log out** in the account menu, Skjera SHALL end their session, and the header SHALL show **Log in** again.

**Test**

- **Given** alice logged in, on the site
- **When** you open the account menu, with alice's name in the header, and click **Log out**
- **Then** you are on the front page, the header shows **Log in**, and the account menu and the **Studio** link are gone

**Automated:** `packages/app/e2e/specs/site.spec.ts`, `packages/oauth/e2e/specs/login.spec.ts`, `packages/oauth/test/Sessions.test.ts`
