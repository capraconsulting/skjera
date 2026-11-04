# SITE-01: Header, logo and footer

The site's header carries Capra's and Liflig's logo, and the browser tab their icon and a title, as in Skjer but without Fryde; all are part of Skjera. The footer carries a heading, groups of logos, links, a link to privacy and a line of text, set by configuration, as the [Readme](../../Readme.md#deploying) describes.

**Set-up:** `mise.toml` already sets a footer, Capra's as in Skjer, so most criteria need nothing more than `pnpm dev`. The site is in English (`SITE_LOCALE`).

## AC-1: The logo, leading to the front page

The header SHALL show Capra's and Liflig's animated logo, and it SHALL lead to the front page.

**Test**

- **Given** the site as `mise.toml` sets it up
- **When** you open an event, then click the logo in the header
- **Then** the header shows the animated logo, turning from Capra to Liflig and back, without «Skjera» beside it, and the click leads to the front page

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

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-4: The tab's icon

The browser tab SHALL show Capra's and Liflig's icon: one ball in both companies' colours, mostly Capra's.

**Test**

- **Given** the site as `mise.toml` sets it up
- **When** you open the front page
- **Then** the tab shows a ball mostly in Capra's turquoise, with Liflig's purple

**Automated:** none

## AC-5: The footer's text and links

WHERE a footer is configured, the site's pages SHALL show its line of text and its links, each link as its logo when it has one, else as its words.

**Test**

- **Given** the site as `mise.toml` sets it up
- **When** you open the front page and look at the footer
- **Then** it says «<this year> © Capra | Torggata 2-4, 0180 Oslo | post@capraconsulting.no», and the «Capra logo» and «Liflig logo» lead to https://www.capraconsulting.no/ and https://www.liflig.no/

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-6: The footer's logos in the dark theme

WHILE the site is shown in the dark theme, the footer SHALL show each logo's dark version where it has one.

**Test**

- **Given** the front page
- **When** you click **Switch to dark mode** in the header
- **Then** the logos in the footer change to their versions for a dark background (the Capra logo turns white), as the header's logo does

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-7: The footer always links to privacy

The footer SHALL always have a **Privacy policy** link, whatever else is configured for it.

**Test**

- **Given** the front page
- **When** you click **Privacy policy** in the footer
- **Then** the privacy page opens ([SITE-10](SITE-10-privacy-page.md))

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-8: The site's own files

WHERE a directory of the site's own files is configured, Skjera SHALL serve each file in it at `/site-assets/`, so that a footer logo can be among them.

**Test**

- **Given** the site as `mise.toml` sets it up, with `dev/site-assets` as the directory
- **When** you open http://localhost:5173/site-assets/logo.svg
- **Then** the logo is shown

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-9: Small logos for Safari

WHERE the visitor's browser is Safari, or any browser on an iPhone or iPad, the header SHALL show the logo's small versions, which those browsers play evenly.

**Test**

- **Given** the front page open in Safari
- **When** you right-click the logo and pick **Open Image in New Tab**
- **Then** the image's address has `logo-dark-sm` in it (`logo-light-sm` in the dark theme)

**Automated:** `packages/app/test/smallLogo.test.ts`

## AC-10: The tab's title

The browser tab SHALL be titled as in Skjer: the front page with the site's name and «Capra Liflig», an event's page with the event's title, and the privacy page with its heading and the site's name.

**Test**

- **Given** the site as `mise.toml` sets it up, in English
- **When** you open the front page, then an event, then **Privacy policy** in the footer
- **Then** the tab reads «Skjera | Capra Liflig», then the event's title, then «Privacy policy | Skjera»

**Automated:** `packages/app/e2e/specs/site.spec.ts`, `packages/app/test/pageTitle.test.ts`

## AC-11: The footer's heading and groups

WHERE the footer is set with a heading and groups of logos, the footer SHALL show the heading, then each group with its title, if it has one, and its logos, then the link to privacy, then the line of text.

**Test**

- **Given** the site as `mise.toml` sets it up
- **When** you open the front page and look at the footer
- **Then** it says «We are part of the Capra Group», then the title «Certifications» over the «Eco-Lighthouse certification» and «DNV certification» logos, then the Capra and Liflig logos without a title, then **Privacy policy**, then the line of text

**Automated:** `packages/app/test/footerView.test.ts`, `packages/app/e2e/specs/site.spec.ts`

## AC-12: A logo without a link is an image only

WHERE a logo in the footer has a link, the footer SHALL link the logo; WHERE it has none, the footer SHALL show the image only.

**Test**

- **Given** the site as `mise.toml` sets it up
- **When** you hover over the certification logos and the Capra logo in the footer
- **Then** the Capra logo is a link and the certification logos are not

**Automated:** `packages/app/test/footerView.test.ts`, `packages/app/e2e/specs/site.spec.ts`

## AC-13: The year and the addresses in the footer's text

WHEN the footer shows a line of text, it SHALL replace `{year}` with the current year, and make email addresses and web addresses in it into links.

**Test**

- **Given** the site as `mise.toml` sets it up
- **When** you open the front page and click **post@capraconsulting.no** in the footer
- **Then** the line starts with this year, and the click opens a new email to post@capraconsulting.no

**Automated:** `packages/app/test/footerView.test.ts`, `packages/app/e2e/specs/site.spec.ts`

## AC-14: A footer text per language

WHERE a text in the footer is given per language, the footer SHALL show the one for the page's language, and the Bokmål one when that language has none.

**Test**

- **Given** the front page
- **When** you open **Language**, the globe in the header, and pick **Bokmål**, then **Nynorsk**, then **English**
- **Then** the heading reads «Vi er en del av Capra-gruppen», then «Vi er ein del av Capra-gruppa», then «We are part of the Capra Group»

**Automated:** `packages/app/test/footerView.test.ts`

## AC-15: A footer that is not valid stops the server

IF `SITE_FOOTER` is not valid, THEN the server SHALL refuse to start and say what is wrong.

**Test**

- **Given** `SITE_FOOTER = "not json"` in `mise.local.toml`
- **When** you restart `pnpm dev`
- **Then** the server does not start, and the message names `SITE_FOOTER`

**Automated:** `packages/documents/test/Model.test.ts`

## AC-16: The profile picture in the menu

WHILE someone is logged in with a Google profile picture, the account menu in the header SHALL show it, 32 pixels wide and round, with the alt text «Profilbilde» («Profile picture» in English), in place of their initials. Without a picture, or when it cannot be loaded, the menu shows their initials. The picture is the `picture` the login gives, so someone already logged in sees it after their next login. The menu is the same on the site and in the studio.

**Test**

- **Given** the site logging in with Google, and an account with a profile picture
- **When** you log in, and look at the menu in the header, on the site and in the studio
- **Then** the menu shows the picture, round, in place of the initials
- **Given** the local login, which has no pictures
- **Then** the menu shows the initials

**Automated:** `packages/app/e2e/specs/site.spec.ts`, `packages/oauth/test/OAuthClient.domains.test.ts`
