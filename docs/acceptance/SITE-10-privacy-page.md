# SITE-10: Privacy page

The site has a privacy page at `/privacy`, saying who answers for the personal data kept, what is kept and why, and who to ask. A policy kept elsewhere can be linked instead.

**Set-up:** `mise.toml` sets `SITE_OPERATOR = "Skjera"` and `SITE_CONTACT_EMAIL = "privacy@skjera.localhost"`, which AC-1, AC-2 and AC-5 use as they are. AC-3, AC-4 and AC-6 change the configuration: add the settings they name under `[env]` in `mise.local.toml`, restart `pnpm dev`, and remove them again afterwards.

**Events:** one public event open to guests, for AC-5 and AC-6.

How long sign-ups are kept is in [SIGN-13](SIGN-13-signup-retention.md) AC-7, and what the page says of HubSpot in [EXT-06](EXT-06-hubspot.md) AC-5 and AC-6.

## AC-1: What is kept, and why

The privacy page SHALL say who answers for the personal data kept, what is kept, why, who sees it, how long it is kept, which cookies and browser storage are used, and the reader's rights.

**Test**

- **Given** the site
- **When** you click **Privacy** in the footer
- **Then** the page starts «Skjera runs Skjera, and answers for the personal data kept here.»
- **And** it has «What we keep», «Why», «Who sees it», «How long», «Cookies and your browser» and «Your rights»

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-2: Where to write

WHERE a contact address is configured, the privacy page SHALL end with it, as a link to write to it.

**Test**

- **Given** the site as `mise.toml` sets it up
- **When** you open `/privacy`
- **Then** «Your rights» ends «Write to privacy@skjera.localhost.», and the address opens a new email to it

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-3: Without an address, ask the operator

IF no contact address is configured, or it is blank, THEN the privacy page SHALL tell the reader to ask the operator.

**Test**

- **Given** `SITE_CONTACT_EMAIL = false` in `mise.local.toml`, and `pnpm dev` restarted
- **When** you open `/privacy`
- **Then** «Your rights» ends «Ask Skjera.», with no address
- **When** you change it to `SITE_CONTACT_EMAIL = " "`, and restart `pnpm dev`
- **Then** «Your rights» still ends «Ask Skjera.», with no address

**Automated:** `packages/documents/test/Model.test.ts`

## AC-4: The operator, or the site's name

The privacy page SHALL name the configured operator as the one who answers for the data, and the site's name when no operator is configured.

**Test**

- **Given** `SITE_OPERATOR = "Example Ltd"` in `mise.local.toml`, and `pnpm dev` restarted
- **When** you open `/privacy`
- **Then** it starts «Example Ltd runs Skjera»
- **When** you change it to `SITE_OPERATOR = false`, add `SITE_NAME = "Example Events"`, and restart `pnpm dev`
- **Then** it starts «Example Events runs Example Events»

**Automated:** none

## AC-5: A link from the guest form

WHERE an event is open to guests, its sign-up form SHALL link to the privacy page with «How we handle your details».

**Test**

- **Given** the event
- **When** you open it in a private window, and click «How we handle your details» under the form
- **Then** the privacy page opens

**Automated:** none

## AC-6: A policy kept elsewhere

WHERE a privacy policy address is configured, the footer's **Privacy** link and the guest form's «How we handle your details» SHALL lead to that address instead of the built-in page, and a request for `/privacy` SHALL be sent on to it.

**Test**

- **Given** `SITE_PRIVACY_URL = "https://example.com/privacy"` in `mise.local.toml`, and `pnpm dev` restarted
- **When** you click **Privacy** in the footer, and «How we handle your details» on the event's form in a private window
- **Then** both lead to https://example.com/privacy
- **When** you open `/privacy` directly
- **Then** the browser ends at https://example.com/privacy, and Back leaves it for the page you came from

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-7: A blank setting is no setting

IF `SITE_OPERATOR`, `SITE_CONTACT_EMAIL` or `SITE_PRIVACY_URL` is set but blank, THEN the privacy page SHALL read as if it were not set.

**Test**

- **Given** `SITE_OPERATOR = " "`, `SITE_CONTACT_EMAIL = " "` and `SITE_PRIVACY_URL = " "` in `mise.local.toml`, and `pnpm dev` restarted
- **When** you open `/privacy`, and click **Privacy** in the footer
- **Then** it starts with the site's name as the one who answers, «Your rights» ends «Ask» and the site's name, and the footer's link leads to the built-in page

**Automated:** `packages/documents/test/Model.test.ts`
