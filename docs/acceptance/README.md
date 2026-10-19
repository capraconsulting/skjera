# Acceptance tests

Acceptance tests for Skjera: each feature with its acceptance criteria, and how a person tests each one by hand. One file per feature, numbered F01 to F18; a criterion is named by both, as in F02 AC-3.

These files say what to test and how. Which criteria have passed in a round of testing is kept outside the repository.

| Feature | File |
| --- | --- |
| F01 | [An event has a place](F01-place.md) |
| F02 | [Maximum number of attendees](F02-max-attendees.md) |
| F03 | [Streaming, in person or online](F03-streaming.md) |
| F04 | [Phone and company for guests](F04-guest-phone-and-company.md) |
| F05 | [Who's coming](F05-whos-coming.md) |
| F06 | [The team as organiser, with its logo](F06-organiser-logo.md) |
| F07 | [Filter on who can sign up](F07-guest-filter.md) |
| F08 | [Test servers](F08-test-servers.md) |
| F09 | [Summary and sharing](F09-summary-and-sharing.md) |
| F10 | [The embed page](F10-embed.md) |
| F11 | [The public events API](F11-public-events-api.md) |
| F12 | [Slack](F12-slack.md) |
| F13 | [Calendar subscription](F13-calendar-subscription.md) |
| F14 | [Dietary preferences without a name](F14-dietary-preferences.md) |
| F15 | [Sign-up data deleted after 30 days](F15-signup-retention.md) |
| F16 | [Recurring events](F16-recurring-events.md) |
| F17 | [Each event's own email texts](F17-email-texts.md) |
| F18 | [HubSpot](F18-hubspot.md) |

## Setting up

Run `pnpm dev` on `main`, as in the [Readme](../../Readme.md). Then:

- **The studio** is at http://localhost:5173/studio. Log in as `alice@example.com`, password `password`. Alice organises the events.
- **The site as a member** is at http://localhost:5173, in another browser or browser profile, logged in as `bob@example.com`, password `password`.
- **Guests** sign up in a private window, without logging in. Use a new email address for each guest, such as `gina1@example.org`: a guest is known by their email.
- **Emails** arrive in Mailpit at http://localhost:8025, whatever address they are sent to.
- **The language** is picked in the site's header. The site starts in English.

Each feature file starts with the events it needs. Create them in a team of their own named after the feature, such as «F02: Maximum number of attendees», and title each event after the criterion it is for, such as «AC-3: A full event refuses new sign-ups». An event is published with **Publish** in the studio, and must have a title, a time and a place.

## Reading a criterion

Each criterion has the same parts:

- **The criterion** as it was agreed.
- **Test**: the test by hand, as *Given* (what must be in place), *When* (what you do, and in which window) and *Then* (what you should see).
- **Automated**: the tests that check it on every push.

Some criteria can't reasonably be tested by hand, such as two people taking the last place at the same moment. They say **Automated only**, with the tests that cover them.
