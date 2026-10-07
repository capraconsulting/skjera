# Skjera

Events for a company: a public site where people sign up (members with their login, guests with name and email), and a studio where organizers write events together and publish them. A rewrite of Skjer, whitelabel: the name, logo, footer and language come from configuration.

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

## Checks and tests

```bash
pnpm lint        # Biome
pnpm typecheck
pnpm test        # unit and integration tests, against the local Postgres and Mailpit
pnpm test:e2e    # Playwright: the whole stack, started for you if it isn't running
```

The pre-commit hook (`.hooks/`, set by `mise run setup`) runs Biome on staged files, typechecks and the tests: Docker must be running, and mise active. There's no CI yet.

## What's where

- [packages/app](packages/app): the React app, site and studio, and the end-to-end tests.
- [packages/server](packages/server): the HTTP server, putting the packages together; bundled for the image.
- [packages/documents](packages/documents): events and teams, drafts (Automerge, in Postgres), publishing, signing up, sync, emails and their background work.
- [packages/oauth](packages/oauth): logging in with OpenID Connect.
- [packages/email](packages/email): sending email, through SES or SMTP.
- [packages/i18n](packages/i18n): the interface's words in English, Bokmål and Nynorsk.
- [packages/snapsync](packages/snapsync): syncing tables to the browser by polling.
- [packages/slack](packages/slack): Slack's API, not wired in yet.

## Deploying

The [Dockerfile](Dockerfile) builds one image: the server, serving the built app too, on port 3000.

```bash
docker build -t skjera .
```

It's configured by environment variables, as in [mise.toml](mise.toml). Needed: `DATABASE_URL` (Postgres 18 with pg_automerge; migrations run at start), `OAUTH_*` (an OIDC provider), `S3_*` (image storage), `SITE_URL`, `SITE_NAME`, `SITE_LOCALE` (the language for those who haven't picked one: `en`, `nb` or `nn`), `EMAIL_FROM`, `SIGNING_SECRET` (any long random string, the same across restarts) and `EMAIL_TRANSPORT=ses` (with `AWS_REGION` and AWS credentials) or `smtp` (with `EMAIL_SMTP_URL`). The server starts without the email settings and the secret, warning that emails aren't sent.

Branding, all optional:

- `SITE_LOGO`, and `SITE_LOGO_DARK` for the dark theme: image URLs (animated WebP works). Shown beside the site's name, or instead of it with `SITE_LOGO_INCLUDES_NAME=true`.
- `SITE_FOOTER`: JSON, `{ "text": "…", "links": [{ "label": "…", "href": "…", "logo": { "src": "…", "darkSrc": "…" } }] }`. The footer always links to privacy.
- `SITE_OPERATOR` (who answers for the personal data kept; the site's name if not set) and `SITE_CONTACT_EMAIL`, for the built-in privacy page at `/privacy`; or `SITE_PRIVACY_URL` to link a policy elsewhere instead.
- `SITE_ASSETS_DIR`: a directory served at `/site-assets/`, e.g. a ConfigMap mounted into the pod, so the logo can be `/site-assets/logo.webp`. In development, `dev/site-assets`.

In Kubernetes:

- Liveness: `GET /health`. Readiness: `GET /health/ready`, which checks the database.
- One replica for now: background work (emails, reminders) runs on an Effect cluster in single-runner mode. More need its runners set up to find each other.
- It stops promptly on SIGTERM.
- WebSockets (`/automerge`, where drafts sync) have to pass through the ingress.

## Languages

The interface and emails are in English, Norwegian Bokmål and Nynorsk: [packages/i18n](packages/i18n), with [Paraglide JS](https://inlang.com/m/gerre34r/library-inlang-paraglideJs). Each language's words are in `messages/{en,nb,nn}.json`; a test checks every message is in each. Event content stays in the language it was written in.
