# Acceptance tests

Acceptance tests for Skjera: each feature with its acceptance criteria, and how a person tests each one by hand. One file per feature, grouped in areas. A feature is named by its area and number, such as SIGN-06, and a criterion by both, as in SIGN-06 AC-3.

These files say what to test and how. Which criteria have passed in a round of testing is kept outside the repository.

## ACC: Login and account

| Feature | File |
| --- | --- |
| ACC-01 | [Logging in and out](ACC-01-login.md) |
| ACC-02 | [Logging out removes local copies of drafts](ACC-02-logout-clears-drafts.md) |
| ACC-03 | [Only accounts from allowed domains](ACC-03-allowed-domains.md) |
| ACC-04 | [The studio and account page need login](ACC-04-login-required.md) |
| ACC-05 | [Account menu and account settings](ACC-05-account-settings.md) |
| ACC-06 | [Language: English, Bokmål and Nynorsk](ACC-06-language.md) |
| ACC-07 | [Light and dark theme](ACC-07-theme.md) |

## STU: Studio

| Feature | File |
| --- | --- |
| STU-01 | [Teams](STU-01-teams.md) |
| STU-02 | [The team as organiser, with its logo](STU-02-organiser-logo.md) |
| STU-03 | [Events in a team](STU-03-events-in-a-team.md) |
| STU-04 | [Editing an event together, live](STU-04-editing-together.md) |
| STU-05 | [Who else has the event open](STU-05-presence.md) |
| STU-06 | [Saving, and editing offline](STU-06-saving-and-offline.md) |
| STU-07 | [The event text: formatting and links](STU-07-text-formatting.md) |
| STU-08 | [Images in the event text](STU-08-images-in-text.md) |
| STU-09 | [Cover image](STU-09-cover-image.md) |
| STU-10 | [Times, time zone and deadlines](STU-10-times-and-deadlines.md) |
| STU-11 | [An event has a place](STU-11-place.md) |
| STU-12 | [Who sees the event, and whether guests can sign up](STU-12-visibility.md) |
| STU-13 | [Food, reminders and other event settings](STU-13-event-settings.md) |
| STU-14 | [Questions on the sign-up form](STU-14-questions-editor.md) |
| STU-15 | [Tags](STU-15-tags.md) |
| STU-16 | [Recurring events](STU-16-recurring-events.md) |
| STU-17 | [Publishing](STU-17-publishing.md) |
| STU-18 | [Confirming a new time before publishing it](STU-18-confirm-new-time.md) |
| STU-19 | [Deleting an event](STU-19-deleting.md) |
| STU-20 | [Unpublishing an event](STU-20-unpublishing.md) |
| STU-21 | [Previewing an event](STU-21-preview.md) |
| STU-22 | [Picking an existing image](STU-22-picking-an-existing-image.md) |
| STU-23 | [Discarding changes](STU-23-discarding-changes.md) |
| STU-24 | [Making a copy of an event](STU-24-copying.md) |
| STU-25 | [Searching and ordering events](STU-25-searching-and-ordering.md) |

## SITE: The public site

| Feature | File |
| --- | --- |
| SITE-01 | [Header, logo and footer](SITE-01-header-and-footer.md) |
| SITE-02 | [Front page: upcoming and past events](SITE-02-front-page.md) |
| SITE-03 | [Filter by tag](SITE-03-tag-filter.md) |
| SITE-04 | [Filter on who can sign up](SITE-04-guest-filter.md) |
| SITE-05 | [The event page](SITE-05-event-page.md) |
| SITE-06 | [Who's coming](SITE-06-whos-coming.md) |
| SITE-07 | [Members-only events](SITE-07-members-only.md) |
| SITE-08 | [Summary and sharing](SITE-08-summary-and-sharing.md) |
| SITE-09 | [The site updates without reloading](SITE-09-live-updates.md) |
| SITE-10 | [Privacy page](SITE-10-privacy-page.md) |
| SITE-11 | [Search engines and sharing services](SITE-11-search-engines-and-sharing.md) |

## SIGN: Signing up

| Feature | File |
| --- | --- |
| SIGN-01 | [Members sign up and cancel](SIGN-01-members.md) |
| SIGN-02 | [Guests sign up with name and email](SIGN-02-guests.md) |
| SIGN-03 | [Phone and company for guests](SIGN-03-guest-phone-and-company.md) |
| SIGN-04 | [A guest's own link to their signup](SIGN-04-guest-link.md) |
| SIGN-05 | [Sign-up deadline](SIGN-05-deadline.md) |
| SIGN-06 | [Maximum number of attendees](SIGN-06-max-attendees.md) |
| SIGN-07 | [Streaming, in person or online](SIGN-07-streaming.md) |
| SIGN-08 | [Dietary preferences, without a name](SIGN-08-dietary-preferences.md) |
| SIGN-09 | [Custom questions on the sign-up form](SIGN-09-custom-questions.md) |
| SIGN-10 | [Changing answers after signing up](SIGN-10-changing-answers.md) |
| SIGN-11 | [Attendee list in the studio](SIGN-11-attendee-list.md) |
| SIGN-12 | [Downloading attendees as an Excel file](SIGN-12-excel.md) |
| SIGN-13 | [Sign-up data deleted after 30 days](SIGN-13-signup-retention.md) |
| SIGN-14 | [Signing up and cancelling are protected against bots and repeated attempts](SIGN-14-bots-and-repeated-attempts.md) |
| SIGN-15 | [Invitations in the studio](SIGN-15-invitations.md) |
| SIGN-16 | [A guest cancels by typing their email on the event page](SIGN-16-guest-cancels-by-email.md) |

## MAIL: Email and calendar

| Feature | File |
| --- | --- |
| MAIL-01 | [Confirmation email when you sign up](MAIL-01-confirmation.md) |
| MAIL-02 | [Email when you cancel](MAIL-02-cancelled-signup.md) |
| MAIL-03 | [Email when the time or place changes](MAIL-03-time-or-place-changed.md) |
| MAIL-04 | [Email when the event is cancelled](MAIL-04-event-cancelled.md) |
| MAIL-05 | [Reminder the morning before](MAIL-05-reminder.md) |
| MAIL-06 | [Each event's own email texts](MAIL-06-email-texts.md) |
| MAIL-07 | [Emails in the language you signed up in](MAIL-07-email-language.md) |

## EXT: Other websites and services

| Feature | File |
| --- | --- |
| EXT-01 | [Calendar invitations that calendar apps understand](EXT-01-calendar-invitations.md) |
| EXT-02 | [Calendar subscription](EXT-02-calendar-subscription.md) |
| EXT-03 | [The embed page](EXT-03-embed.md) |
| EXT-04 | [The public events API](EXT-04-public-events-api.md) |
| EXT-05 | [Slack](EXT-05-slack.md) |
| EXT-06 | [HubSpot](EXT-06-hubspot.md) |

## OPS: Operations

Not seen by those using the site: tested by someone running commands.

| Feature | File |
| --- | --- |
| OPS-01 | [Configuration, and starting without email](OPS-01-configuration.md) |
| OPS-02 | [Health checks](OPS-02-health-checks.md) |
| OPS-03 | [The image and running it](OPS-03-image.md) |
| OPS-04 | [Background work delivered once](OPS-04-background-work.md) |
| OPS-05 | [Checks and CI](OPS-05-checks-and-ci.md) |
| OPS-06 | [Local development stack](OPS-06-local-development.md) |
| OPS-07 | [Test servers](OPS-07-test-servers.md) |
| OPS-08 | [The /playground page](OPS-08-playground.md) |

## Setting up

Run `pnpm dev` on `main`, as in the [Readme](../../Readme.md). Then:

- **The studio** is at http://localhost:5173/studio. Log in as `alice@example.com`, password `password`. Alice organises the events.
- **The site as a member** is at http://localhost:5173, in another browser or browser profile, logged in as `bob@example.com`, password `password`.
- **Guests** sign up in a private window, without logging in. Use a new email address for each guest, such as `gina1@example.org`: a guest is known by their email.
- **Emails** arrive in Mailpit at http://localhost:8025, whatever address they are sent to.
- **The language** is picked in the site's header. The site starts in English.

Each feature file starts with the events it needs. They are in a team of their own named after the feature, such as «SIGN-06: Maximum number of attendees», and each event is titled after the criterion it is for, such as «AC-3: A full event refuses new sign-ups». An event made by hand is published with **Publish** in the studio, and must have a title, a time and a place.

**Filling and emptying the test data.** With `pnpm dev` running, `mise run testdata` makes every file's teams, events and signups in the local database, published or as drafts as the file says, with times set from when it runs. Running it again starts them over. `mise run testdata:clear` removes them, and tells nobody. Both stop and change nothing unless `DATABASE_URL` is a database on `localhost` or `127.0.0.1`, which mise sets from `mise.toml`.

- **What goes.** Every team named after a feature file, with all that is in it, a team of that name made by hand too. Other teams and events stay, and so does a hand-made «Capra Gruppen» with its events.
- **All files at once.** Every file's events exist together, so lists such as the front page, `/embed` and the calendar show other files' events too: count them in.
- **No emails, no Slack posts.** Signups are made without them, so a criterion that reads the email sent when someone signs up has bob, or the guest, cancel and sign up again first. Only the events of MAIL-05 and the STU-13 events that remind (the ones on **Default** open to guests, and the ones on **On**) remind those signed up. They start the day after tomorrow, and the running server sends their reminders at 07:05 UTC on the morning before.
- **Changing a file.** A change to an **Events:** section is made in `packages/server/testdata/catalogue.ts` too: a test fails when a team or event the sections name is not made there.
- **Left to the tester.** Settings in `mise.local.toml`, then restarting `pnpm dev`; bob in a second browser; guests in a private window; the images and texts a criterion has you bring; and the steps a criterion itself takes.

## Reading a criterion

Each criterion has the same parts:

- **The criterion** as it was agreed.
- **Test**: the test by hand, as *Given* (what must be in place), *When* (what you do, and in which window) and *Then* (what you should see).
- **Automated**: the tests that check it on every push.

Some criteria can't reasonably be tested by hand, such as two people taking the last place at the same moment. They say **Automated only**, with the tests that cover them.
