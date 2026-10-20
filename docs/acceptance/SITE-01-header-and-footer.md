# SITE-01: Header, logo and footer

The site's header and footer carry its own branding: its name and logo, a line of text and links in the footer, and a link to privacy. All of it is set by configuration, as the [Readme](../../Readme.md#deploying) describes.

**Set-up:** `mise.toml` already sets a logo, a dark logo and a footer, so most criteria need nothing more than `pnpm dev`. AC-3 and AC-4 change the configuration: add the settings they name under `[env]` in `mise.local.toml`, restart `pnpm dev`, and remove them again afterwards.

## AC-1: The logo beside the name, leading to the front page

WHERE a logo is configured, the header SHALL show it beside the site's name, and both SHALL lead to the front page.

**Test**

- **Given** the site as `mise.toml` sets it up
- **When** you open an event, then click the logo or «Skjera» in the header
- **Then** the header shows the logo with «Skjera» beside it, and the click leads to the front page

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-2: The dark theme shows the dark logo

WHILE the site is shown in the dark theme, the header SHALL show the site's dark logo in place of its light one.

**Test**

- **Given** the front page in the light theme
- **When** you click **Switch to dark mode** in the header
- **Then** the logo changes to its dark version

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-3: A logo with the name in it

WHERE the logo is configured to include the site's name, the header SHALL show the logo alone, without the name beside it.

**Test**

- **Given** `SITE_LOGO_INCLUDES_NAME = "true"` in `mise.local.toml`, and `pnpm dev` restarted
- **When** you open the front page
- **Then** the header shows the logo, without «Skjera» beside it

**Automated:** none

## AC-4: No logo, the name alone

WHERE no logo is configured, the header SHALL show the site's name alone.

**Test**

- **Given** `SITE_LOGO = false` and `SITE_LOGO_DARK = false` in `mise.local.toml`, and `pnpm dev` restarted
- **When** you open the front page
- **Then** the header shows «Skjera» alone, as words, leading to the front page

**Automated:** none

## AC-5: The footer's text and links

WHERE a footer is configured, the site's pages SHALL show its line of text and its links, each link as its logo when it has one, else as its words.

**Test**

- **Given** the site as `mise.toml` sets it up
- **When** you open the front page and look at the footer
- **Then** it says «Skjera · Events, together · privacy@skjera.localhost», and shows the logo of «Example Ltd», leading to https://example.com

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-6: The footer's logos in the dark theme

WHILE the site is shown in the dark theme, the footer SHALL show a link's dark logo where it has one.

**Test**

- **Given** the front page
- **When** you click **Switch to dark mode** in the header
- **Then** the «Example Ltd» logo in the footer changes to its dark version, as the header's logo does

**Automated:** none

## AC-7: The footer always links to privacy

The footer SHALL always have a **Privacy** link, whatever else is configured for it.

**Test**

- **Given** the front page
- **When** you click **Privacy** in the footer
- **Then** the privacy page opens ([SITE-10](SITE-10-privacy-page.md))

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-8: The site's own files

WHERE a directory of the site's own files is configured, Skjera SHALL serve each file in it at `/site-assets/`, so that the logo can be one of them.

**Test**

- **Given** the site as `mise.toml` sets it up, with `dev/site-assets` as the directory
- **When** you open http://localhost:5173/site-assets/logo.svg
- **Then** the logo is shown, the same file as in the header

**Automated:** `packages/app/e2e/specs/site.spec.ts`
