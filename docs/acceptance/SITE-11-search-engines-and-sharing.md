# SITE-11: Search engines and sharing services

Search engines are kept from the event pages while the services that show a preview of a shared link may fetch them, the site can be added to a phone's home screen, and each page tells search engines and sharing services what it is.

**Set-up:** `mise.toml` sets `SITE_DESCRIPTION = "Skjer | Capra Liflig"`, `SITE_TWITTER = "@capraconsulting"`, `SITE_AUTHOR = "Capra Consulting"` and `SITE_PUBLISHER = "Capra Consulting"`, which the criteria below use as they are.

What the server tells is only served by the built app, not by `pnpm dev`. Test AC-1 to AC-6 on a test server ([OPS-07](OPS-07-test-servers.md)): `PORT=8801 mise exec -- pnpm test-server`. It has a database of its own, so create SITE-08's public event there first, at http://localhost:8801/studio, with a cover image.

## AC-1: Search engines keep out of the event pages

`/robots.txt` SHALL stop search engines from indexing `/events/`, and SHALL let the preview crawlers of LinkedIn, Slack, Facebook and Teams fetch it.

**Test**

- **Given** the test server
- **When** you run `curl -s http://localhost:8801/robots.txt`
- **Then** `User-agent: *` has `Disallow: /events/`
- **And** `LinkedInBot`, `Slackbot-LinkExpanding`, `facebookexternalhit` and `SkypeUriPreview` are in a group with `Allow: /`

Once deployed, check that each service still shows a preview of an event's address: LinkedIn's Post Inspector, Facebook's Sharing Debugger, and a message to yourself in Slack and Teams.

**Automated:** `packages/app/test/searchAndSharing.test.ts`

## AC-2: The site can be added to the home screen

Skjera SHALL serve a web app manifest with the site's name, `display: standalone`, its colours and its icon, linked from every page of the app.

**Test**

- **Given** the test server
- **When** you run `curl -s http://localhost:8801/manifest.webmanifest`
- **Then** it has `name` and `short_name` with the site's name, `start_url` `/`, `display` `standalone`, `theme_color`, `background_color` and the icon `/favicon.ico`
- **And** `curl -s http://localhost:8801/` has `<link rel="manifest" href="/manifest.webmanifest">` in its head
- **And** in `pnpm dev`, http://localhost:5173/manifest.webmanifest gives the manifest, not the page

**Automated:** `packages/documents/test/site/Manifest.test.ts`, `packages/app/test/searchAndSharing.test.ts`

## AC-3: An event page has its own address

An event page's head SHALL have its canonical address, `{SITE_URL}/events/{id}`. WHERE `SITE_URL` is not set, it SHALL have none.

**Test**

- **Given** SITE-08's public event on the test server
- **When** you run `curl -s http://localhost:8801/events/<id>`
- **Then** the head has `<link rel="canonical" href="http://localhost:8801/events/<id>">`

**Automated:** `packages/app/e2e/specs/site.spec.ts`, `packages/documents/test/site/Sharing.test.ts`

## AC-4: The Twitter handle, author and publisher

WHERE the configuration gives a Twitter handle, author or publisher, an event page's head SHALL include `twitter:site`, `author` and `publisher` with them, and leave out the ones it does not give.

**Test**

- **Given** SITE-08's public event on the test server
- **When** you fetch its page as in AC-3
- **Then** the head has `twitter:site` `@capraconsulting`, `author` `Capra Consulting` and `publisher` `Capra Consulting`

**Automated:** `packages/documents/test/site/Sharing.test.ts`

## AC-5: The image's size and when the event was first published

An event page's head SHALL give the cover image's width and height as the image has them, and `article:published_time` from when the event was first published. WHERE the size cannot be read from the image, the head SHALL leave it out.

**Test**

- **Given** SITE-08's public event, with a cover image
- **When** you fetch its page as in AC-3
- **Then** `og:image:width` and `og:image:height` are the cover's width and height in pixels
- **And** `article:published_time` is the time the event was first published, in ISO 8601, and does not change when the event is published again

**Automated:** `packages/documents/test/events/Images.test.ts`, `packages/documents/test/site/Sharing.test.ts`

## AC-6: Every page has the site's description

Every page of the app SHALL have the site's description in its head, from `SITE_DESCRIPTION`. An event page with a summary SHALL have the summary as its only description.

**Test**

- **Given** the test server
- **When** you run `curl -s http://localhost:8801/`, and the same for `/privacy`, for the page of an id that is no event, and for a page that fails a login
- **Then** the head has `<meta name="description" content="Skjer | Capra Liflig">`
- **And** SITE-08's event page, which has a summary, has the summary as its description and no other

**Automated:** `packages/app/e2e/specs/site.spec.ts`, `packages/documents/test/site/Sharing.test.ts`
