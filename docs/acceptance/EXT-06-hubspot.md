# EXT-06: HubSpot

The site loads HubSpot on every page but the embed.

**Set-up:** for AC-1, AC-2 and AC-5, put a HubSpot account id under `[env]` in `mise.local.toml`, such as `HUBSPOT_ACCOUNT_ID = "12345678"`, and restart `pnpm dev`. A made-up id is enough to see the script being fetched, and sends nothing to a real account. Remove it again for AC-3 and AC-6.

**Events:** one public event open to guests.

## AC-1: Every page loads HubSpot's script

Where the server is configured with a HubSpot account id, every page of the site shall load HubSpot's script for that account from `js-eu1.hs-scripts.com`.

**Test**

- **Given** a HubSpot account id set, and the developer tools' **Network** tab open
- **When** you visit the front page, the event, `/account` and `/privacy`
- **Then** each fetches `js-eu1.hs-scripts.com/<id>.js`

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-2: Not the embed page or the studio

The page at `/embed` and the studio shall not load HubSpot's script.

**Test**

- **Given** the same
- **When** you visit `/embed` and the studio
- **Then** nothing is fetched from HubSpot

**Automated:** `packages/app/e2e/specs/embed.spec.ts`, `packages/app/e2e/specs/site.spec.ts`, `packages/documents/test/site/Embed.test.ts`

## AC-3: Without an account, nothing from HubSpot

Where no HubSpot account id is configured, no page shall load anything from HubSpot.

**Test**

- **Given** no HubSpot account id
- **When** you visit the same pages as in AC-1
- **Then** nothing is fetched from HubSpot on any of them

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-4: The guest form's field names

The guest sign-up form shall name its fields `firstname`, `email`, `telephone` and `company`, as HubSpot reads them.

**Test**

- **Given** the event open in a private window
- **When** you right-click each field of the guest form and pick **Inspect**
- **Then** they are named `firstname`, `email`, `telephone` and `company`

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`

## AC-5: The privacy page tells of HubSpot

Where a HubSpot account id is configured, the privacy page shall say, in Norwegian Bokmål, Nynorsk and English, that HubSpot is used for visitor statistics and cookies, and shall have a button that opens HubSpot's cookie settings.

**Test**

- **Given** a HubSpot account id set
- **When** you open `/privacy` in each language
- **Then** it names HubSpot for visitor statistics and cookies, and has a **Cookie settings** button

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-6: Without an account, the privacy page as before

Where no HubSpot account id is configured, the privacy page shall read as it does today.

**Test**

- **Given** no HubSpot account id
- **When** you open `/privacy`
- **Then** it doesn't name HubSpot, and «Cookies and your browser» says «Nothing tracks you.»

**Automated:** `packages/app/e2e/specs/site.spec.ts`
