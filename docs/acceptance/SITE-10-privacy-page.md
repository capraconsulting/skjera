# SITE-10: Privacy page

The site has a privacy page at `/privacy`, the privacy policy of Skjer in ten sections, saying who answers for the personal data kept, what is kept and why, who it is shared with and how to complain. It follows the site's language. A policy kept elsewhere can be linked instead.

**Set-up:** `mise.toml` sets `SITE_OPERATOR = "Skjera"`, `SITE_OPERATOR_ORG_NUMBER = "123 456 789"`, `SITE_OPERATOR_ADDRESS = "Storgata 1, 0150 Oslo"` and `SITE_CONTACT_EMAIL = "privacy@skjera.localhost"`, which AC-1, AC-2, AC-5 and AC-8 use as they are. AC-3, AC-4, AC-6, AC-7 and AC-8 change the configuration: add the settings they name under `[env]` in `mise.local.toml`, restart `pnpm dev`, and remove them again afterwards.

**Events:** one public event open to guests, for AC-5 and AC-6.

How long sign-ups are kept is in [SIGN-13](SIGN-13-signup-retention.md) AC-7, and what the page says of HubSpot in [EXT-06](EXT-06-hubspot.md) AC-5 and AC-6.

## AC-1: The policy's sections

The privacy page SHALL have a section for each of: who is responsible, your rights (with how to complain), whose personal data is processed, how it is collected, purpose, legal basis and storage, how it is processed, who it is shared with, security, cookies, and how to contact the operator.

**Test**

- **Given** the site
- **When** you click **Privacy policy** in the footer
- **Then** the page is headed «Privacy policy», and has «1. Data controller», «2. Your rights», «3. Whose personal data we process», «4. How we collect personal data», «5. Purpose, legal basis and storage», «6. How we process personal data», «7. Who we share personal data with», «8. Security», «9. Cookies» and «10. Contact us»
- **And** it ends «This privacy policy was last updated»

**Automated:** `packages/app/e2e/specs/site/site.spec.ts`

## AC-2: Where to write

WHERE a contact address is configured, the privacy page SHALL give it as a link to write to, in «1. Data controller» and in «10. Contact us».

**Test**

- **Given** the site as `mise.toml` sets it up
- **When** you open `/privacy`
- **Then** «10. Contact us» ends with privacy@skjera.localhost, and the address opens a new email to it

**Automated:** `packages/app/e2e/specs/site/site.spec.ts`

## AC-3: Without an address, ask the operator

IF no contact address is configured, or it is blank, THEN the privacy page SHALL leave out the e-mail lines and tell the reader to ask the operator.

**Test**

- **Given** `SITE_CONTACT_EMAIL = false` in `mise.local.toml`, and `pnpm dev` restarted
- **When** you open `/privacy`
- **Then** «10. Contact us» ends «Ask Skjera.», with no address, and «1. Data controller» has no email line
- **When** you change it to `SITE_CONTACT_EMAIL = " "`, and restart `pnpm dev`
- **Then** «10. Contact us» still ends «Ask Skjera.», with no address

**Automated:** `packages/documents/test/Model.test.ts`, `packages/app/e2e/specs/site/site.spec.ts`

## AC-4: The operator, or the site's name

The privacy page SHALL name the configured operator as the one who answers for the data, and the site's name when no operator is configured.

**Test**

- **Given** `SITE_OPERATOR = "Example Ltd"` in `mise.local.toml`, and `pnpm dev` restarted
- **When** you open `/privacy`
- **Then** «1. Data controller» says «Example Ltd, represented by its managing director, is the data controller»
- **When** you change it to `SITE_OPERATOR = false`, add `SITE_NAME = "Example Events"`, and restart `pnpm dev`
- **Then** it says «Example Events, represented by its managing director, is the data controller»

**Automated:** `packages/documents/test/Model.test.ts`, `packages/app/e2e/specs/site/site.spec.ts`

## AC-5: A link from the guest form

WHERE an event is open to guests, its sign-up form SHALL link to the privacy page with «How we handle your details».

**Test**

- **Given** the event
- **When** you open it in a private window, and click «How we handle your details» under the form
- **Then** the privacy page opens

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`

## AC-6: A policy kept elsewhere

WHERE a privacy policy address is configured, the footer's **Privacy policy** link and the guest form's «How we handle your details» SHALL lead to that address instead of the built-in page, and a request for `/privacy` SHALL be sent on to it.

**Test**

- **Given** `SITE_PRIVACY_URL = "https://example.com/privacy"` in `mise.local.toml`, and `pnpm dev` restarted
- **When** you click **Privacy policy** in the footer, and «How we handle your details» on the event's form in a private window
- **Then** both lead to https://example.com/privacy
- **When** you open `/privacy` directly
- **Then** the browser ends at https://example.com/privacy, and Back leaves it for the page you came from

**Automated:** `packages/app/e2e/specs/site/site.spec.ts`

## AC-7: A blank setting is no setting

IF `SITE_OPERATOR`, `SITE_OPERATOR_ORG_NUMBER`, `SITE_OPERATOR_ADDRESS`, `SITE_CONTACT_EMAIL` or `SITE_PRIVACY_URL` is set but blank, THEN the privacy page SHALL read as if it were not set.

**Test**

- **Given** `SITE_OPERATOR = " "`, `SITE_OPERATOR_ORG_NUMBER = " "`, `SITE_OPERATOR_ADDRESS = " "`, `SITE_CONTACT_EMAIL = " "` and `SITE_PRIVACY_URL = " "` in `mise.local.toml`, and `pnpm dev` restarted
- **When** you open `/privacy`, and click **Privacy policy** in the footer
- **Then** «1. Data controller» names the site as the one who answers, with no organisation number, address or email line, «10. Contact us» ends «Ask» and the site's name, and the footer's link leads to the built-in page

**Automated:** `packages/documents/test/Model.test.ts`

## AC-8: The organisation number and the address

WHERE an organisation number or an address is configured, «1. Data controller» SHALL show it as «Organisation number: …» and «Business address: …», and «10. Contact us» SHALL show the address; WHERE one is not configured, its line SHALL be left out.

**Test**

- **Given** the site as `mise.toml` sets it up
- **When** you open `/privacy`
- **Then** «1. Data controller» shows «Organisation number: 123 456 789» and «Business address: Storgata 1, 0150 Oslo», and «10. Contact us» shows «Storgata 1, 0150 Oslo»
- **When** you add `SITE_OPERATOR_ORG_NUMBER = false` and `SITE_OPERATOR_ADDRESS = false` in `mise.local.toml`, and restart `pnpm dev`
- **Then** neither line is there, and nor is the address in «10. Contact us»

**Automated:** `packages/documents/test/Model.test.ts`, `packages/app/e2e/specs/site/site.spec.ts`
