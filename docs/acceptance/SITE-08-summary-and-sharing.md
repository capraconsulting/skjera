# SITE-08: Summary and sharing

An event has a summary, and a link to it shared on LinkedIn or Slack shows its title, image and summary.

**Events:** one public event with a summary and a cover image, one event for members only, and bob signed up to the public one.

What a shared link shows is only served by the built app, not by `pnpm dev`. Test AC-4 to AC-7 on a test server ([OPS-07](OPS-07-test-servers.md)): `PORT=8801 mise exec -- pnpm test-server`. It has a database of its own, so create the two events there first, at http://localhost:8801/studio.

## AC-1: The summary is written in the studio

The studio SHALL let an organiser write an event's summary as plain text.

**Test**

- **Given** an event open in the studio
- **When** you write in **Summary**
- **Then** it takes plain text, with no formatting buttons

**Automated:** `packages/app/e2e/specs/site.spec.ts`, `packages/documents/test/events/content.test.ts`

## AC-2: The page shows it under the title

WHERE an event has a summary, the event page SHALL show it under the title.

**Test**

- **Given** the public event, published with a summary
- **When** you open it on the site
- **Then** the summary is under the title

**Automated:** `packages/app/e2e/specs/site.spec.ts`, `packages/documents/test/events/content.test.ts`

## AC-3: Invitations carry it as their description

WHERE an event has a summary, every calendar invitation Skjera sends for the event SHALL carry the summary as its description.

**Test**

- **Given** bob signed up to the public event
- **When** you open the invitation in his email in Mailpit
- **Then** `DESCRIPTION` has the summary

**Automated:** `packages/app/e2e/specs/attendance/emails.spec.ts`, `packages/documents/test/site/Calendar.test.ts`, `packages/documents/test/notices/signups.test.tsx`

## AC-4: A shared public event shows title, summary and image

WHEN `/events/:id` is fetched for an event shown to everyone, the server SHALL answer with the event's title, summary and cover image as the page's title, description and image for sharing.

**Test**

- **Given** the public event on the test server
- **When** you run `curl -s http://localhost:8801/events/<id>`, with its id from its address
- **Then** `og:title`, `og:description` and `og:image` have its title, summary and cover

**Automated:** `packages/app/e2e/specs/site.spec.ts`, `packages/documents/test/site/Sharing.test.ts`

## AC-5: A members-only event shares nothing of itself

IF `/events/:id` is fetched for an event shown only to members, THEN the server SHALL answer with only the site's name for sharing, never the event's title, summary or image.

**Test**

- **Given** the members-only event on the test server
- **When** you fetch it the same way
- **Then** only the site's name is there, and nothing of the event

**Automated:** `packages/app/e2e/specs/site.spec.ts`, `packages/documents/test/site/Sharing.test.ts`

## AC-6: An unknown event shares only the site's name

IF `/events/:id` names no published event, THEN the server SHALL answer with only the site's name for sharing.

**Test**

- **Given** the test server
- **When** you fetch `/events/` with an id that doesn't exist
- **Then** only the site's name is there

**Automated:** `packages/app/e2e/specs/site.spec.ts`, `packages/documents/test/site/Sharing.test.ts`

## AC-7: The page still works in the browser

The page fetched from `/events/:id` SHALL work in the browser as it does today.

**Test**

- **Given** the public event on the test server
- **When** you open http://localhost:8801/events/<id> in a browser and sign up
- **Then** the page works as it does with `pnpm dev`

**Automated:** `packages/app/e2e/specs/site.spec.ts`, `packages/app/e2e/specs/attendance/dietary.spec.ts`, `packages/app/e2e/specs/attendance/emails.spec.ts`, `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/app/e2e/specs/attendance/limit.spec.ts`, `packages/app/e2e/specs/attendance/members.spec.ts`, `packages/app/e2e/specs/attendance/questions.spec.ts`, `packages/app/e2e/specs/attendance/streaming.spec.ts`, `packages/app/e2e/specs/attendance/whos-coming.spec.ts`, `packages/documents/test/site/Sharing.test.ts`
