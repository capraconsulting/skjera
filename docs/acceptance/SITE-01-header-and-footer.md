# SITE-01: Header, logo and footer

The site's header carries Capra's and Liflig's logo, as in Skjer, and the browser tab Skjer's icon; both are part of Skjera. The footer carries a line of text, links and a link to privacy, set by configuration, as the [Readme](../../Readme.md#deploying) describes.

**Set-up:** `mise.toml` already sets a footer, so most criteria need nothing more than `pnpm dev`.

## AC-1: The logo, leading to the front page

The header SHALL show Capra's and Liflig's animated logo, and it SHALL lead to the front page.

**Test**

- **Given** the site as `mise.toml` sets it up
- **When** you open an event, then click the logo in the header
- **Then** the header shows the animated Capra and Liflig logo, without «Skjera» beside it, and the click leads to the front page

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-2: The dark theme shows the light logo

WHILE the site is shown in the dark theme, the header SHALL show the logo's version for a dark background in place of the one for a light background.

**Test**

- **Given** the front page in the light theme
- **When** you pick **Dark** in the theme menu in the header
- **Then** the logo changes to its version in white

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-3: A still logo for less motion

WHILE the visitor's device asks for reduced motion, the header SHALL show the still logo in place of the animated one.

**Test**

- **Given** «Reduce motion» turned on in the Mac's accessibility settings (Display)
- **When** you open the front page
- **Then** the header shows the still logo, in either theme

**Automated:** none

## AC-4: The tab's icon

The browser tab SHALL show Skjer's icon.

**Test**

- **Given** the site as `mise.toml` sets it up
- **When** you open the front page
- **Then** the tab shows the same icon as Skjer's

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

WHERE a directory of the site's own files is configured, Skjera SHALL serve each file in it at `/site-assets/`, so that the footer's logos can be among them.

**Test**

- **Given** the site as `mise.toml` sets it up, with `dev/site-assets` as the directory
- **When** you open http://localhost:5173/site-assets/logo.svg
- **Then** the logo is shown, the same file as in the footer

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-9: Small logos for Safari

WHERE the visitor's browser is Safari, or any browser on an iPhone or iPad, the header SHALL show the logo's small versions, which those browsers play evenly.

**Test**

- **Given** the front page open in Safari
- **When** you right-click the logo and pick **Open Image in New Tab**
- **Then** the image's address has `logo-dark-sm` in it (`logo-light-sm` in the dark theme)

**Automated:** `packages/app/test/smallLogo.test.ts`
