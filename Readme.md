# Skjera

Events for a company: a public site where people sign up (members with their login, guests with name and email), and a studio where organizers write events together and publish them. A rewrite of Skjer, with Capra's and Liflig's logo and tab icon: the name, footer and language come from configuration.

## Getting started

You need [mise](https://mise.jdx.dev) and Docker. mise installs the right Node and pnpm, and holds the development configuration (`[env]` in [mise.toml](mise.toml): no secrets beyond local ones). Docker runs the local services, from images pinned by digest in [compose.yml](compose.yml).

```bash
mise trust
mise install
mise run setup   # dependencies, git hooks, Playwright's browser
pnpm dev         # everything, in mprocs
```

Commands need mise's environment: [activate mise](https://mise.jdx.dev/getting-started.html#activate-mise) in your shell (or prefix them with `mise exec --`). After changing `mise.toml`, restart `pnpm dev`: running processes keep the environment they started with.

`pnpm dev` starts Postgres, Dex (logins), RustFS (images), Mailpit (email), the server, the app and the message compiler:

- The site and studio: http://localhost:5173. Log in as `alice@example.com` or `bob@example.com`, password `password` (`mallory@other.example` is outside the allowed domain, to try being refused).
- Emails sent: http://localhost:8025 (Mailpit).

The local Postgres is [pg_automerge](https://github.com/TheKnarf/pg-automerge)'s released image (Postgres 18 with the extension). Table syncing uses [snapsync](packages/snapsync), pure SQL in this repository, which the server's migrations install: Postgres needs nothing of ours beyond pg_automerge. Local data is test data: `docker compose down -v` starts it over.

With `pnpm dev` running, `mise run testdata` fills the local database with the teams and events [docs/acceptance](docs/acceptance/README.md) describes, and `mise run testdata:clear` takes them out again: teams and events made by hand stay. `docker compose down -v` still starts everything over. What the commands leave to the tester is under [Setting up](docs/acceptance/README.md#setting-up).

## Checks and tests

```bash
pnpm lint        # Biome
pnpm typecheck
pnpm test        # unit and integration tests, against the local Postgres and Mailpit
pnpm test:e2e    # Playwright, against a test server of its own (port 8806, a new database each run)
```

The browser tests are in `packages/app/e2e/specs`, and work the pages through page objects in `packages/app/e2e/pom`, one class per page or part of one: a test calls `new EventEditor(page).publish()`, not Playwright's locators. A page object missing what a test needs gets it added there. Setting a test up (browsers signed in or not, unique names, cleaning up after) is in `packages/app/e2e/fixtures`.

The browser tests' test server runs with `SIGNUP_LIMITS=off`, since they sign up far more often than the limits on signing up allow; `on` (the default) is everywhere else, and another value stops the server at start.

[docs/acceptance](docs/acceptance/README.md) has each feature's acceptance criteria, how a person tests each one by hand, and the tests that check it.

The pre-commit hook (`.hooks/`, set by `mise run setup`) runs Biome on staged files, typechecks and the tests: Docker must be running, and mise active. GitHub (`.github/workflows/ci.yml`) runs the same checks, the browser tests and an image build on every push to main and every pull request.

## Test servers

A checkout, such as a branch's worktree, is served as a test server on one port, with its own database:

```bash
PORT=8801 mise exec -- pnpm test-server
```

It installs, builds the app and the server from the working tree, creates a new database `skjera_testserver_<port>_<random>` in the development Postgres, and serves both on `PORT` until it is stopped (SIGINT or SIGTERM). The development services must be running: `pnpm dev`, or `docker compose up --detach --wait postgres dex rustfs mailpit` in a checkout. In a new worktree, run `mise trust` first.

- **Its address** is `SKJERA_TEST_SERVER_URL`: `http://<host>` or `https://<host>`, without a port, and `http://localhost` when it isn't set. It belongs to the machine, so set it in the machine's own mise config (`~/.config/mise/config.toml`, `[env]`) or its shell, not in this repository. The test server's links, including the ones in its emails, use it with the port. With `https://` it listens on `127.0.0.1` only, since the TLS proxy holds the port on the machine's other addresses. Restart `pnpm dev` (or the services) after changing it.
- **Logging in** works from other machines on ports 8801–8806, the callbacks Dex knows. Cookies are per host, not per port, so logging in on one test server logs you out of another at the same host.
- **Email** is read in Mailpit at the same address on port 8025, which is open to other machines while the address is set. Dex is at the same address on port 5556. With `https://`, both need the same TLS proxy as the test servers, for example `tailscale serve --bg --https 5556 http://127.0.0.1:5556` and `tailscale serve --bg --https 8025 http://127.0.0.1:8025`.
- **The databases** are not dropped when a test server stops, but the next test server on the same port drops those no running server uses. List them with `psql "$DATABASE_URL"` and `\l skjera_testserver_*`, and drop one with `DROP DATABASE <name>`.

## What's where

- [packages/app](packages/app): the React app, site and studio, and the end-to-end tests.
- [packages/server](packages/server): the HTTP server, putting the packages together; bundled for the image.
- [packages/documents](packages/documents): events and teams, drafts (Automerge, in Postgres), publishing, signing up, sync, emails and their background work.
- [packages/oauth](packages/oauth): logging in with OpenID Connect.
- [packages/email](packages/email): sending email, through SES or SMTP.
- [packages/i18n](packages/i18n): the interface's words in English, Bokmål and Nynorsk.
- [packages/snapsync](packages/snapsync): syncing tables to the browser by polling.
- [packages/slack](packages/slack): Slack's API: posts new events and sign-up deadlines to a channel.

## Deploying

The [Dockerfile](Dockerfile) builds one image: the server, serving the built app too, on port 3000.

```bash
docker build -t skjera .
```

It's configured by environment variables, as in [mise.toml](mise.toml). Needed: `DATABASE_URL` (Postgres 18 with pg_automerge; migrations run at start), `OAUTH_*` (an OIDC provider), `S3_*` (image storage; the key must be allowed to list the bucket, as well as to read and write it, since the studio lists the images already uploaded), `SITE_URL`, `SITE_NAME`, `SITE_LOCALE` (the language for those who haven't picked one: `en`, `nb` or `nn`), `EMAIL_FROM`, `SIGNING_SECRET` (any long random string, the same across restarts) and `EMAIL_TRANSPORT=ses` (with `AWS_REGION` and AWS credentials) or `smtp` (with `EMAIL_SMTP_URL`). The server starts without the email settings and the secret, warning that emails aren't sent.

Signing up and cancelling are limited per visitor (guests: 20 an hour from an address, 10 a minute from an address and browser; members: 40 and 20), and the guest forms have a hidden field a bot fills in. The limits count the visitor's address from `X-Forwarded-For`, so set:

- `PROXY_COUNT`: how many proxies stand in front of the server, each appending to `X-Forwarded-For` (1 by default: the ingress). The address that many entries from the right is the visitor's. Use 0 when visitors reach the server directly, 2 with a CDN in front of the ingress. After a deploy, check from two networks that each is counted on its own (SIGN-14 AC-6). A value that is not a whole number of 0 or more stops the server at start.

The counts are kept in the server's memory: a restart clears them, and each replica counts its own.

Branding, all optional:

- `SITE_FOOTER`: JSON with these keys, all optional: `heading` (a line above the rest), `groups` (logos side by side, each `{ "title": "…", "logos": [{ "label": "…", "src": "…", "darkSrc": "…", "href": "…" }] }`; `title`, `darkSrc` and `href` are optional, and a logo without `href` is an image only), `links` (`[{ "label": "…", "href": "…", "logo": { "src": "…", "darkSrc": "…" } }]`) and `text` (a line under the rest, where `{year}` becomes the current year and email addresses and web addresses starting with `http://`, `https://` or `www.` become links). `src` is the image for a light background and `darkSrc` the one for a dark background. Every text (`heading`, `title`, `label`, `text`) is a string, or `{ "nb": "…", "nn": "…", "en": "…" }` for one per language: `nb` is required, and the Bokmål text is shown where the page's language has none. With `groups` the footer is laid out as Skjer's, with the privacy link after the logos; without, the links come first and the privacy link sits beside the text. A key that isn't one of these is ignored; a value that isn't valid (not JSON, a logo without `src`, a per-language text without `nb`) stops the server at start. The footer always links to privacy. [mise.toml](mise.toml) sets Capra's footer, as Skjer's, with its logos in `packages/app/public/footer`; set that value in a deployment only once it runs this version, since an older server refuses a per-language text.
- `SITE_OPERATOR` (who answers for the personal data kept; the site's name if not set), `SITE_OPERATOR_ORG_NUMBER`, `SITE_OPERATOR_ADDRESS` (one line, e.g. `Torggata 2-4, 0180 Oslo`) and `SITE_CONTACT_EMAIL`, for the built-in privacy page at `/privacy`, which leaves out a line whose setting is not set; or `SITE_PRIVACY_URL` to link a policy elsewhere instead.
- `SITE_DESCRIPTION` (the description search engines show under the site, e.g. `Skjer | Capra Liflig`; in the head of every page of the app, and of an event page without a summary), `SITE_TWITTER` (e.g. `@capraconsulting`, as `twitter:site` on event pages), `SITE_AUTHOR` and `SITE_PUBLISHER` (e.g. `Capra Consulting`, as the author and publisher of event pages). A setting that is not set leaves its tag out. [mise.toml](mise.toml) sets Capra's values; a deployment gets them only once they are set there too.
- `SITE_ASSETS_DIR`: a directory served at `/site-assets/`, e.g. a ConfigMap mounted into the pod, so a footer logo can be `/site-assets/logo.webp`. In development, `dev/site-assets`.

Also optional, for websites that show the next events (`/embed`) in an iframe, or read the coming events shown to everyone from the browser (`/api/public/events`: JSON in Skjer's format, served when `SITE_URL` is set; an event of the team "Capra Gruppen" is organised by "Alle", others by their team's name):

- `WEBSITE_ORIGINS`: the websites that may do so, each address they are served at, separated by spaces or commas, e.g. `https://www.capraconsulting.no, https://capraconsulting.no, https://www.liflig.no, https://liflig.no`. List the address with `www.` and the one without when a website answers at both. Without it, no website may. A value that is not such an address (no path, query or user; `http:` or `https:`) stops the server at start.

`GET /api/subscribe` is a calendar of every coming event, those shown only to members too, that «Abonner», beside the account menu, adds to Google Calendar. It is open to anyone with the address, served when `SITE_URL` is set, named after the site (`SITE_NAME`), and says where to sign up in `SITE_LOCALE`.

Also optional, Slack: `SLACK_BOT_TOKEN`, the bot token of an app made from [packages/slack/manifest.yaml](packages/slack/manifest.yaml), and `SLACK_CHANNEL`, the id of a channel the bot has been invited to (e.g. `C0123ABC`). With both, and `SITE_URL`, Skjera posts each event the first time it is published, with `@here`, and each recurring event when it has moved on to its next date, with `@here` and `:repeat:`, and at 07:00 UTC the events whose sign-up deadline runs out within a day, with `@channel`: every event, those shown only to members too, with times in Norwegian time. Slack fetches the cover from `SITE_URL`; when it cannot, the event is posted without it. Without them nothing is posted, with a warning at start.

Also optional, HubSpot: `HUBSPOT_ACCOUNT_ID`, the account id as HubSpot shows it (digits). With it, every page of the site but `/embed` and the studio loads HubSpot's script for that account from `js-eu1.hs-scripts.com`, and the privacy page says so, with a button for HubSpot's cookie settings. What HubSpot does with the page (statistics, cookie banner, collected forms) is set up in the HubSpot account. Without it, or blank, nothing is loaded from HubSpot. A value that is not digits stops the server at start.

In Kubernetes:

- Liveness: `GET /health`. Readiness: `GET /health/ready`, which checks the database.
- One replica for now: background work (emails, reminders, Slack messages, moving recurring events) runs on an Effect cluster in single-runner mode. More need its runners set up to find each other.
- It stops promptly on SIGTERM.
- WebSockets (`/automerge`, where drafts sync) have to pass through the ingress.

## Languages

The interface and emails are in English, Norwegian Bokmål and Nynorsk: [packages/i18n](packages/i18n), with [Paraglide JS](https://inlang.com/m/gerre34r/library-inlang-paraglideJs). Each language's words are in `messages/{en,nb,nn}.json`; a test checks every message is in each. Event content stays in the language it was written in.
